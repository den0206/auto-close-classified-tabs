import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-close-classified-tabs-'));

function fixture(name: string, body = '// fixture\n'): vscode.Uri {
  const file = path.join(tmp, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return vscode.Uri.file(file);
}

const allTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs);
const tabCount = () => allTabs().length;

/** 条件が満たされるまで待つ。デバウンス(150ms)と VS Code の非同期処理を吸収する。 */
async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(cond(), `条件が ${ms}ms 以内に満たされなかった (タブ数: ${tabCount()})`);
}

async function openAll(names: string[]): Promise<void> {
  for (const name of names) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture(name)), {
      preview: false,
    });
  }
}

async function setConfig(key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration('autoCloseClassifiedTabs')
    .update(key, value, vscode.ConfigurationTarget.Global);
}

suite('auto-close-classified-tabs', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('yuuki-sakai.auto-close-classified-tabs')?.activate();
    await setConfig('maxTabs', 3);
    await setConfig('enabled', true);
  });

  setup(async () => {
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs));
  });

  suiteTeardown(async () => {
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((g) => g.tabs));
    await setConfig('maxTabs', undefined);
    await setConfig('enabled', undefined);
    fs.rmSync(tmp, { recursive: true, force: true }); // 一時ファイルを残さない
  });

  test('5 ファイルを開くと 3 枚に収束する', async () => {
    await openAll(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
    await waitFor(() => tabCount() === 3);
  });

  test('未保存のタブは残る', async () => {
    await openAll(['dirty.ts']);
    const editor = vscode.window.activeTextEditor!;
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'unsaved\n'));
    assert.ok(editor.document.isDirty);

    await openAll(['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts']);
    await waitFor(() => tabCount() <= 4);
    const labels = vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label));
    assert.ok(labels.includes('dirty.ts'), `未保存タブが閉じられた: ${labels.join(', ')}`);
  });

  test('ピン留めしたタブは残る', async () => {
    await openAll(['keep.ts']);
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    await openAll(['g1.ts', 'g2.ts', 'g3.ts', 'g4.ts']);
    await waitFor(() => tabCount() <= 4);
    const labels = vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label));
    assert.ok(labels.includes('keep.ts'), `ピン留めタブが閉じられた: ${labels.join(', ')}`);
  });

  test('分割した両方のグループが上限まで減る', async () => {
    await openAll(['s1.ts', 's2.ts', 's3.ts', 's4.ts']);
    await waitFor(() => tabCount() === 3);
    await vscode.commands.executeCommand('workbench.action.splitEditor');
    for (const name of ['s5.ts', 's6.ts', 's7.ts', 's8.ts']) {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture(name)), {
        preview: false,
        viewColumn: vscode.ViewColumn.Two,
      });
    }
    await waitFor(() => vscode.window.tabGroups.all.every((g) => g.tabs.length <= 3));
    assert.equal(vscode.window.tabGroups.all.length, 2);
  });

  test('差分タブも自動クローズの対象になる', async () => {
    await vscode.commands.executeCommand('vscode.diff', fixture('left.ts', 'a\n'), fixture('right.ts', 'b\n'));
    await waitFor(() => vscode.window.tabGroups.all.some((g) =>
      g.tabs.some((t) => t.input instanceof vscode.TabInputTextDiff)));
    await openAll(['d1.ts', 'd2.ts', 'd3.ts', 'd4.ts']);
    await waitFor(() => tabCount() === 3);
  });

  test('enabled が false なら 1 枚も閉じない', async () => {
    await setConfig('enabled', false);
    try {
      await openAll(['x1.ts', 'x2.ts', 'x3.ts', 'x4.ts', 'x5.ts']);
      await new Promise((r) => setTimeout(r, 800));
      assert.equal(tabCount(), 5);
    } finally {
      await setConfig('enabled', true);
    }
  });

  test('maxTabs の変更が即座に反映される', async () => {
    await openAll(['m1.ts', 'm2.ts', 'm3.ts']);
    await waitFor(() => tabCount() === 3);
    await setConfig('maxTabs', 1);
    try {
      await waitFor(() => tabCount() === 1);
    } finally {
      await setConfig('maxTabs', 3);
    }
  });

  test('「今すぐ閉じる」は enabled が false でも閉じる', async () => {
    await setConfig('enabled', false);
    try {
      await openAll(['n1.ts', 'n2.ts', 'n3.ts', 'n4.ts', 'n5.ts']);
      assert.equal(tabCount(), 5, '自動クローズが止まっていない');
      await vscode.commands.executeCommand('autoCloseClassifiedTabs.closeUnused');
      await waitFor(() => tabCount() === 3);
      // 閉じるものが無い状態で呼んでも失敗しない(案内を出して正常終了する)
      await vscode.commands.executeCommand('autoCloseClassifiedTabs.closeUnused');
      assert.equal(tabCount(), 3);
    } finally {
      await setConfig('enabled', true);
    }
  });

  test('closeOnStartup が false でも、開いたタブは通常どおり閉じる', async () => {
    // このフラグが効くのは activate 時の 1 回だけ。全体の無効化として実装されると壊れる
    await setConfig('closeOnStartup', false);
    try {
      await openAll(['b1.ts', 'b2.ts', 'b3.ts', 'b4.ts', 'b5.ts']);
      await waitFor(() => tabCount() === 3);
    } finally {
      await setConfig('closeOnStartup', undefined);
    }
  });

  test('コマンドがすべて登録されている', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ['closeUnused', 'toggleProtect', 'enableTabDecorations', 'restoreDecorationDefaults', 'applyLabelIcons', 'removeLabelIcons']) {
      assert.ok(all.includes(`autoCloseClassifiedTabs.${id}`), `未登録: ${id}`);
    }
  });

  test('種別アイコンの設定は適用後に完全に削除できる', async () => {
    const key = 'workbench.editor.customLabels.patterns';
    const before = vscode.workspace.getConfiguration().get<Record<string, string>>(key);
    await vscode.commands.executeCommand('autoCloseClassifiedTabs.applyLabelIcons');
    const applied = vscode.workspace.getConfiguration().get<Record<string, string>>(key) ?? {};
    assert.ok(Object.keys(applied).length > 0);

    await vscode.commands.executeCommand('autoCloseClassifiedTabs.removeLabelIcons');
    const after = vscode.workspace.getConfiguration().get<Record<string, string>>(key);
    assert.deepEqual(after ?? undefined, before ?? undefined, '設定が元に戻っていない');
  });

  test('差分タブは種別上限どおり 1 枚に制限される', async () => {
    await setConfig('maxTabsByType', { diff: 1 });
    try {
      const diffCount = () =>
        allTabs().filter((t) => t.input instanceof vscode.TabInputTextDiff).length;
      for (const n of [1, 2, 3]) {
        const opened = diffCount();
        await vscode.commands.executeCommand(
          'vscode.diff',
          fixture(`old${n}.ts`, 'a\n'),
          fixture(`new${n}.ts`, 'b\n'),
        );
        // 開き終わるのを待つ。開いた直後に上限で閉じられることもあるので増減どちらでも抜ける
        await waitFor(() => diffCount() !== opened || allTabs().some((t) => t.label.includes(`new${n}.ts`)));
      }
      await waitFor(() => diffCount() === 1);
    } finally {
      await setConfig('maxTabsByType', undefined);
    }
  });

  test('種別上限はコードファイルには効かない', async () => {
    await setConfig('maxTabsByType', { diff: 1 });
    try {
      await openAll(['k1.ts', 'k2.ts', 'k3.ts']);
      await new Promise((r) => setTimeout(r, 600));
      assert.equal(tabCount(), 3, 'コードファイルが種別上限で閉じられた');
    } finally {
      await setConfig('maxTabsByType', undefined);
    }
  });

  test('色の表示をタブだけに限定し、既定へ戻せる', async () => {
    try {
      await vscode.commands.executeCommand('autoCloseClassifiedTabs.enableTabDecorations');
      const editor = vscode.workspace.getConfiguration('workbench.editor.decorations');
      const explorer = vscode.workspace.getConfiguration('explorer.decorations');
      assert.equal(editor.get('colors'), true, 'タブの色が有効になっていない');
      assert.equal(editor.get('badges'), true, 'タブのバッジが有効になっていない');
      assert.equal(explorer.get('colors'), false, 'エクスプローラーのファイル名の色が残っている');
      assert.equal(explorer.get('badges'), false, 'エクスプローラーのバッジが残っている');
    } finally {
      await vscode.commands.executeCommand('autoCloseClassifiedTabs.restoreDecorationDefaults');
    }
    // 書いた 4 つの設定が消えて既定へ戻ること（VS Code 側の既定値は問わない）
    for (const [section, key] of [
      ['workbench.editor.decorations', 'colors'],
      ['workbench.editor.decorations', 'badges'],
      ['explorer.decorations', 'colors'],
      ['explorer.decorations', 'badges'],
    ] as const) {
      const info = vscode.workspace.getConfiguration(section).inspect(key);
      assert.equal(info?.globalValue, undefined, `設定が残っている: ${section}.${key}`);
    }
  });

  test('装飾を有効にする前に書いていた設定は、元に戻すと戻ってくる', async () => {
    // 一律に undefined を書くと、自分の意思で false にしていた人の設定まで消える
    const explorer = () => vscode.workspace.getConfiguration('explorer.decorations');
    const editor = () => vscode.workspace.getConfiguration('workbench.editor.decorations');
    await explorer().update('badges', false, vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('autoCloseClassifiedTabs.enableTabDecorations');
      await vscode.commands.executeCommand('autoCloseClassifiedTabs.restoreDecorationDefaults');
      assert.equal(
        explorer().inspect('badges')?.globalValue,
        false,
        'ユーザーが元々書いていた値が消えた',
      );
    } finally {
      for (const cfg of [explorer(), editor()]) {
        for (const key of ['colors', 'badges']) {
          await cfg.update(key, undefined, vscode.ConfigurationTarget.Global);
        }
      }
    }
  });

  test('別グループのタブを保護しても、そのタブだけがピン留めされタブは増えない', async () => {
    await openAll(['p1.ts']);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture('p2.ts')), {
      preview: false,
      viewColumn: vscode.ViewColumn.Two,
    });
    await waitFor(() => vscode.window.tabGroups.all.length === 2);
    const before = tabCount();

    await vscode.commands.executeCommand('autoCloseClassifiedTabs.toggleProtect', fixture('p1.ts'));
    await waitFor(() => allTabs().some((t) => t.label === 'p1.ts' && t.isPinned));

    const labels = allTabs().map((t) => t.label).join(', ');
    // showTextDocument で前面に出す実装だと、p1.ts がもう 1 枚開いてそちらがピン留めされる
    assert.equal(tabCount(), before, `タブが増えた: ${labels}`);
    assert.ok(!allTabs().find((t) => t.label === 'p2.ts')?.isPinned, `p2.ts が保護された: ${labels}`);

    await vscode.commands.executeCommand('autoCloseClassifiedTabs.toggleProtect', fixture('p1.ts'));
    await waitFor(() => allTabs().every((t) => !t.isPinned));
  });

  test('同じファイルを 2 グループで開いても、ピン留めした方は残る', async () => {
    // 選定キーが URI だけだと、グループ 1 の選定結果でグループ 2 のコピーまで閉じられる
    const shared = fixture('shared.ts');
    for (const column of [vscode.ViewColumn.One, vscode.ViewColumn.Two]) {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(shared), {
        preview: false,
        viewColumn: column,
      });
    }
    await waitFor(() => vscode.window.tabGroups.all.length === 2);

    // いまアクティブなのはグループ 2 の shared.ts
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    await waitFor(() => allTabs().some((t) => t.label === 'shared.ts' && t.isPinned));

    // グループ 1 だけを溢れさせ、そちらの shared.ts(最も古い)を閉じさせる
    for (const name of ['q1.ts', 'q2.ts', 'q3.ts', 'q4.ts']) {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture(name)), {
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      });
    }
    await waitFor(() => vscode.window.tabGroups.all.every((g) => g.tabs.length <= 3));

    const labels = allTabs().map((t) => `${t.label}${t.isPinned ? '(pinned)' : ''}`).join(', ');
    assert.ok(
      allTabs().some((t) => t.label === 'shared.ts' && t.isPinned),
      `ピン留めした別グループのコピーまで閉じられた: ${labels}`,
    );
  });

  test('同じ記号を使ったユーザー自身のパターンは消さない', async () => {
    const key = 'workbench.editor.customLabels.patterns';
    const read = () => vscode.workspace.getConfiguration().get<Record<string, string>>(key);
    const before = read();
    // 値(記号)は拡張が書くものと同じだが、キーの形が違うのでユーザーのもの
    await vscode.workspace.getConfiguration().update(key, {
      '**/vendor/*.js': '🟨 ${filename}',
    }, vscode.ConfigurationTarget.Global);

    await vscode.commands.executeCommand('autoCloseClassifiedTabs.applyLabelIcons');
    await vscode.commands.executeCommand('autoCloseClassifiedTabs.removeLabelIcons');

    const after = read() ?? {};
    assert.deepEqual(
      Object.keys(after),
      ['**/vendor/*.js'],
      `ユーザー自身のパターンを消した: ${JSON.stringify(after)}`,
    );
    await vscode.workspace.getConfiguration().update(key, before, vscode.ConfigurationTarget.Global);
  });

  test('旧版が書いた種別アイコンのパターンも取り除ける', async () => {
    const key = 'workbench.editor.customLabels.patterns';
    const read = () => vscode.workspace.getConfiguration().get<Record<string, string>>(key);
    const before = read();
    // 拡張子を 1 つ足した旧版が書いたキー(字面は今と違うが記号は同じ)と、ユーザー自身のパターン
    await vscode.workspace.getConfiguration().update(key, {
      '**/*.{cts,mts,ts,zzz}': '🟦 ${filename}',
      '**/legacy/*.ts': '🏚 ${filename}',
    }, vscode.ConfigurationTarget.Global);

    await vscode.commands.executeCommand('autoCloseClassifiedTabs.applyLabelIcons');
    await vscode.commands.executeCommand('autoCloseClassifiedTabs.removeLabelIcons');

    const after = read() ?? {};
    assert.deepEqual(
      Object.keys(after),
      ['**/legacy/*.ts'],
      `旧版のキーが残ったか、ユーザーのパターンを消した: ${JSON.stringify(after)}`,
    );
    await vscode.workspace.getConfiguration().update(key, before, vscode.ConfigurationTarget.Global);
  });
});
