import type { ConversationAccessDto } from '@novachat-enterprise-erp/contracts';
import type { InternalHttpClient } from '@novachat-enterprise-erp/common';

export interface ConversationAccess {
  isMember(workspaceId: string, conversationId: string, userId: string): Promise<boolean>;
  conversationIds(workspaceId: string, userId: string): Promise<string[]>;
}

export class MessageServiceConversationAccess implements ConversationAccess {
  constructor(private readonly client: InternalHttpClient) {}

  async isMember(workspaceId: string, conversationId: string, userId: string): Promise<boolean> {
    const access = await this.client.request<ConversationAccessDto>(
      `/internal/conversations/${conversationId}/access/${encodeURIComponent(userId)}`,
    );
    return !!access && access.workspaceId === workspaceId && access.isMember;
  }

  async conversationIds(workspaceId: string, userId: string): Promise<string[]> {
    const result = await this.client.request<{ items: string[] }>(
      `/internal/workspaces/${workspaceId}/users/${encodeURIComponent(userId)}/conversations`,
    );
    return result?.items ?? [];
  }
}
