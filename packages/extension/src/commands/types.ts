import { ShadowTreeProvider } from '../ShadowTreeProvider';
import { ShadowCreatorProvider } from '../ShadowCreatorProvider';
import { PromptLibraryViewProvider } from '../PromptLibraryViewProvider';
import { PromptLibraryProvider } from '../PromptLibraryProvider';
import { MissionTemplateProvider } from '../MissionTemplateProvider';
import { StatusEventBus } from '../StatusEventBus';

export interface CommandDeps {
  rootPath: string | undefined;
  shadowTreeProvider: ShadowTreeProvider;
  creatorProvider: ShadowCreatorProvider;
  promptLibraryProvider: PromptLibraryProvider;
  promptLibraryViewProvider: PromptLibraryViewProvider;
  missionTemplateProvider: MissionTemplateProvider;
  statusBus: StatusEventBus;
}
