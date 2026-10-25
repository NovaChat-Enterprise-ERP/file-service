import type { Logger, ReadinessCheck } from '@novachat-enterprise-erp/common';
import type { EventPublisher } from '@novachat-enterprise-erp/events';
import type { FileRepository } from './repositories/file.repository.js';
import type { FolderRepository } from './repositories/folder.repository.js';
import type { ObjectStorage } from './providers/object-storage.js';
import type { ConversationAccess } from './providers/conversation-access.js';
import { FileService, type FileServiceConfig } from './services/file.service.js';
import { FolderService } from './services/folder.service.js';
import { AvatarService } from './services/avatar.service.js';
import { FileController } from './controllers/file.controller.js';
import { FolderController } from './controllers/folder.controller.js';
import { AvatarController } from './controllers/avatar.controller.js';

export interface ContainerDeps {
  logger: Logger;
  internalSecret: string;
  publicAppUrl: string;
  files: FileRepository;
  folders: FolderRepository;
  storage: ObjectStorage;
  conversations: ConversationAccess;
  events: EventPublisher;
  config: FileServiceConfig;
  readiness?: Record<string, ReadinessCheck>;
}

export const buildContainer = (deps: ContainerDeps) => {
  const services = {
    files: new FileService(deps.files, deps.folders, deps.storage, deps.conversations, deps.events, deps.config, deps.logger),
    folders: new FolderService(deps.folders),
    avatars: new AvatarService(deps.storage, deps.publicAppUrl),
  };
  return {
    logger: deps.logger,
    internalSecret: deps.internalSecret,
    readiness: deps.readiness ?? {},
    services,
    controllers: {
      files: new FileController(services.files),
      folders: new FolderController(services.folders),
      avatars: new AvatarController(services.avatars),
    },
  };
};

export type Container = ReturnType<typeof buildContainer>;
