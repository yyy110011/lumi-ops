import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  copyFile: vi.fn(),
  pathExists: vi.fn(),
  remove: vi.fn(),
  accessSync: vi.fn(),
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    pathExists: vi.fn(),
    remove: vi.fn(),
    accessSync: vi.fn(),
  },
}));

vi.mock('fs-extra', () => ({
  default: mockFs.default,
  ...mockFs,
}));

vi.mock('chalk', () => ({
  default: {
    red: vi.fn((s: string) => s),
    yellow: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
  },
}));

import { analyzeBundle, generateSimplePatch, patchApply, patchRevert, patchStatus } from './patch';

// ─── Fixture: simulated minified bundle snippet ──────────────────────────────
// This simulates the structural shape of the real Antigravity bundle
const FAKE_CLASS_BODY = `
var sEn=class extends ne{constructor(e,i,n,s,r,o){super(),this.C=e,this.O=i,this.P=n}mb(){this.xb()}
initializeWorkspaceInfo(){const e=this.O.getWorkspace().folders.map(n=>n.uri.toString())}
sendMessageToChatPanel(e){const i=[es(uG,{chunk:{case:"text",value:e}})];this.openPanel(),this.b.fire({actionType:"sendMessage",payload:i.map(n=>fie(uG,n))})}async insertCodeInTerminal(e){let i=this.gb.activeInstance}};
li(Npe,sEn,1);var h0u=function(t,e,i,n){};
`;

describe('patch - analyzeBundle', () => {
  it('should find sendMessageToChatPanel and extract variable names', () => {
    const result = analyzeBundle(FAKE_CLASS_BODY);

    expect(result.className).toBe('sEn');
    expect(result.serviceId).toBe('Npe');
    expect(result.workspaceProp).toBe('O');
    expect(result.emitterProp).toBe('b');
    expect(result.protoCreate).toBe('es');
    expect(result.protoType).toBe('uG');
    expect(result.protoSerialize).toBe('fie');
    expect(result.registrationString).toBe('li(Npe,sEn,1)');
  });

  it('should throw when sendMessageToChatPanel is not found', () => {
    expect(() => analyzeBundle('var x = 1;')).toThrow('Could not find sendMessageToChatPanel');
  });

  it('should throw when DI registration is not found', () => {
    const partial = `sendMessageToChatPanel(e){const i=[es(uG,{chunk:{case:"text",value:e}})];this.openPanel(),this.b.fire({actionType:"sendMessage",payload:i.map(n=>fie(uG,n))})}`;
    expect(() => analyzeBundle(partial)).toThrow('Could not find DI registration');
  });
});

describe('patch - generateSimplePatch', () => {
  it('should generate valid JS with LUMI marker', () => {
    const match = analyzeBundle(FAKE_CLASS_BODY);
    const patch = generateSimplePatch(match, 'Read MISSION.md');

    expect(patch).toContain('/*LUMI:autostart*/');
    expect(patch).toContain('sEn.prototype.mb');
    expect(patch).toContain('.getWorkspace().folders');
    expect(patch).toContain('.worktrees/');
    expect(patch).toContain('sendMessageToChatPanel');
    expect(patch).toContain('Read MISSION.md');
    expect(patch).not.toContain('require("fs")');
  });

  it('should use the extracted workspace property', () => {
    const match = analyzeBundle(FAKE_CLASS_BODY);
    const patch = generateSimplePatch(match, 'test');

    // Should reference self.O (the workspace service property)
    expect(patch).toContain(`self.${match.workspaceProp}.getWorkspace()`);
  });

  it('should escape single quotes in message', () => {
    const match = analyzeBundle(FAKE_CLASS_BODY);
    const patch = generateSimplePatch(match, "it's a test");

    expect(patch).toContain("it\\'s a test");
  });
});

describe('patch - double-patch prevention', () => {
  it('should detect existing patch marker', () => {
    const patched = '/*LUMI:autostart*/(function(){})();' + FAKE_CLASS_BODY;
    expect(patched.includes('/*LUMI:autostart*/')).toBe(true);
  });
});

describe('patch commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('patchStatus', () => {
    it('should report not patched when marker is absent', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFs.readFile.mockResolvedValue(FAKE_CLASS_BODY);
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.accessSync.mockImplementation(() => {}); // path detection

      await patchStatus({ path: '/fake/out' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Not patched'));
      consoleSpy.mockRestore();
    });

    it('should report patched when marker is present', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFs.readFile.mockResolvedValue('/*LUMI:autostart*/' + FAKE_CLASS_BODY);
      mockFs.pathExists.mockResolvedValue(true);

      await patchStatus({ path: '/fake/out' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Patched'));
      consoleSpy.mockRestore();
    });
  });

  describe('patchApply', () => {
    it('should create backup and patch the file', async () => {
      mockFs.readFile.mockResolvedValue(FAKE_CLASS_BODY);
      mockFs.pathExists.mockResolvedValue(false);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await patchApply({ path: '/fake/out' });

      // Should have created backup
      expect(mockFs.copyFile).toHaveBeenCalled();
      // Should have written patched file
      expect(mockFs.writeFile).toHaveBeenCalled();
      const writtenContent = mockFs.writeFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain('/*LUMI:autostart*/');

      consoleSpy.mockRestore();
    });

    it('should refuse to double-patch', async () => {
      const patched = FAKE_CLASS_BODY.replace('li(Npe,sEn,1);', 'li(Npe,sEn,1);/*LUMI:autostart*/(function(){})();');
      mockFs.readFile.mockResolvedValue(patched);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await patchApply({ path: '/fake/out' });

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Already patched'));

      consoleSpy.mockRestore();
    });
  });

  describe('patchRevert', () => {
    it('should restore backup and remove backup file', async () => {
      mockFs.pathExists.mockResolvedValue(true);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.remove.mockResolvedValue(undefined);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await patchRevert({ path: '/fake/out' });

      expect(mockFs.copyFile).toHaveBeenCalled();
      expect(mockFs.remove).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Reverted'));

      consoleSpy.mockRestore();
    });

    it('should error when no backup exists', async () => {
      mockFs.pathExists.mockResolvedValue(false);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await patchRevert({ path: '/fake/out' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No backup found'));
      consoleSpy.mockRestore();
    });
  });
});
