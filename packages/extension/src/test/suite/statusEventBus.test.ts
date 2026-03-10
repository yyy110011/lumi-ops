import * as assert from 'assert';
import * as vscode from 'vscode';

suite('StatusEventBus', () => {
  const extensionId = 'ZunRenYao.lumi-ops';
  let statusBus: any;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(extensionId)!;
    const exports = await extension.activate();
    assert.ok(exports.statusBus, 'Extension should export statusBus');
    statusBus = exports.statusBus;
  });

  test('fire() triggers onDidChange listeners', (done) => {
    const disposable = statusBus.onDidChange((value: string) => {
      disposable.dispose();
      assert.ok(value, 'Should receive a value');
      done();
    });

    statusBus.fire('test-branch');
  });

  test('fire() with no args sends "*"', (done) => {
    const disposable = statusBus.onDidChange((value: string) => {
      disposable.dispose();
      assert.strictEqual(value, '*', 'Default fire() should send "*"');
      done();
    });

    statusBus.fire();
  });

  test('fire() with specific branch sends that branch name', (done) => {
    const disposable = statusBus.onDidChange((value: string) => {
      disposable.dispose();
      assert.strictEqual(value, 'feat/my-feature', 'Should receive specific branch name');
      done();
    });

    statusBus.fire('feat/my-feature');
  });

  test('multiple listeners all receive events', (done) => {
    let received = 0;
    const target = 2;

    function check() {
      received++;
      if (received === target) {
        disposable1.dispose();
        disposable2.dispose();
        done();
      }
    }

    const disposable1 = statusBus.onDidChange(() => check());
    const disposable2 = statusBus.onDidChange(() => check());

    statusBus.fire('multi-test');
  });

  test('disposed listener does not receive events', (done) => {
    let disposedReceived = false;

    const disposedListener = statusBus.onDidChange(() => {
      disposedReceived = true;
    });

    // Dispose the first listener before firing
    disposedListener.dispose();

    // Add a second listener to verify the event was fired
    const activeListener = statusBus.onDidChange(() => {
      activeListener.dispose();
      // Give a small delay to ensure the disposed listener would have been called if still active
      setTimeout(() => {
        assert.strictEqual(disposedReceived, false, 'Disposed listener should not receive events');
        done();
      }, 50);
    });

    statusBus.fire('after-dispose');
  });
});
