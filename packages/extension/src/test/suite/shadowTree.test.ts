import * as assert from 'assert';
import * as vscode from 'vscode';

suite('ShadowTreeProvider (TreeView)', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let exports: any;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    exports = await extension.activate();
    assert.ok(exports, 'Extension should export an API object');
    assert.ok(exports.shadowTreeProvider, 'Extension should export shadowTreeProvider');
  });

  test('shadowTreeProvider has getChildren method', () => {
    assert.strictEqual(
      typeof exports.shadowTreeProvider.getChildren,
      'function',
      'shadowTreeProvider.getChildren should be a function'
    );
  });

  test('shadowTreeProvider has getTreeItem method', () => {
    assert.strictEqual(
      typeof exports.shadowTreeProvider.getTreeItem,
      'function',
      'shadowTreeProvider.getTreeItem should be a function'
    );
  });

  test('getChildren() returns items for the test fixture workspace', async () => {
    const items = await exports.shadowTreeProvider.getChildren();
    assert.ok(Array.isArray(items), 'getChildren() should return an array');
    // The test fixture workspace is a real git repo — should have at least the current branch
    assert.ok(items.length >= 1, 'Should return at least the current branch item');
  });

  test('first item is the current branch root', async () => {
    const items = await exports.shadowTreeProvider.getChildren();
    assert.ok(items.length >= 1, 'Should have at least one item');

    const rootItem = items[0];
    assert.strictEqual(
      rootItem.contextValue,
      'currentBranch',
      'First item should have contextValue "currentBranch"'
    );
  });

  test('current branch item has a label', async () => {
    const items = await exports.shadowTreeProvider.getChildren();
    const rootItem = items[0];
    assert.ok(rootItem.label, 'Current branch item should have a non-empty label');
    assert.strictEqual(typeof rootItem.label, 'string', 'Label should be a string');
  });

  test('current branch item has returnToRoot command', async () => {
    const items = await exports.shadowTreeProvider.getChildren();
    const rootItem = items[0];
    assert.ok(rootItem.command, 'Current branch item should have a command');
    assert.strictEqual(
      rootItem.command.command,
      'lumi-ops.returnToRoot',
      'Command should be lumi-ops.returnToRoot'
    );
  });

  test('current branch item has a tooltip', async () => {
    const items = await exports.shadowTreeProvider.getChildren();
    const rootItem = items[0];
    assert.ok(rootItem.tooltip, 'Current branch item should have a tooltip');
  });

  test('getChildren(element) returns empty for leaf nodes', async () => {
    const items = await exports.shadowTreeProvider.getChildren();
    if (items.length > 0) {
      const children = await exports.shadowTreeProvider.getChildren(items[0]);
      assert.ok(Array.isArray(children), 'getChildren(element) should return an array');
      assert.strictEqual(children.length, 0, 'Leaf nodes should have no children');
    }
  });

  test('refresh command executes without error', async () => {
    // lumi-ops.refresh triggers shadowTreeProvider.refresh()
    await assert.doesNotReject(
      async () => { await vscode.commands.executeCommand('lumi-ops.refresh'); },
      'Refresh command should execute without error'
    );
  });

  test('getTreeItem returns the same element', () => {
    // getTreeItem is an identity function in ShadowTreeProvider
    const mockItem = { label: 'test' };
    const result = exports.shadowTreeProvider.getTreeItem(mockItem);
    assert.strictEqual(result, mockItem, 'getTreeItem should return the element as-is');
  });
});
