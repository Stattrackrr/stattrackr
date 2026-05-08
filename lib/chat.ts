import { supabase } from '@/lib/supabaseClient';

export const CHAT_MESSAGE_LIMIT = 50;
export const CHAT_MAX_MESSAGE_LENGTH = 500;
export const CHAT_REACTION_OPTIONS = ['👍', '🔥', '😂', '👀', '💰', '✅'] as const;

export type ChatRoomSlug = 'general' | 'picks';

export type ChatRoom = {
  id: string;
  slug: ChatRoomSlug;
  name: string;
  description: string | null;
  is_premium: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  display_name: string;
  avatar_url: string | null;
  reply_to_message_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

export type ChatMessageReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export async function fetchChatRooms(): Promise<ChatRoom[]> {
  const { data, error } = await (supabase
    .from('chat_rooms') as any)
    .select('id, slug, name, description, is_premium, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ChatRoom[];
}

export async function fetchChatMessages(roomId: string, limit = CHAT_MESSAGE_LIMIT): Promise<ChatMessage[]> {
  const { data, error } = await (supabase
    .from('chat_messages') as any)
    .select('id, room_id, user_id, body, display_name, avatar_url, reply_to_message_id, created_at, updated_at, deleted_at, deleted_by')
    .eq('room_id', roomId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function sendChatMessage(
  roomId: string,
  body: string,
  replyToMessageId?: string | null
): Promise<ChatMessage> {
  const trimmedBody = body.trim();
  const { data, error } = await (supabase
    .from('chat_messages') as any)
    .insert({
      room_id: roomId,
      body: trimmedBody,
      reply_to_message_id: replyToMessageId ?? null,
    })
    .select('id, room_id, user_id, body, display_name, avatar_url, reply_to_message_id, created_at, updated_at, deleted_at, deleted_by')
    .single();

  if (error) {
    throw error;
  }

  return data as ChatMessage;
}

export async function deleteChatMessage(messageId: string): Promise<ChatMessage> {
  const { data, error } = await ((supabase as any).rpc('soft_delete_chat_message', {
    target_message_id: messageId,
  }) as any);

  if (error) {
    throw error;
  }

  return data as ChatMessage;
}

export async function fetchChatReactions(messageIds: string[]): Promise<ChatMessageReaction[]> {
  if (messageIds.length === 0) {
    return [];
  }

  const { data, error } = await (supabase
    .from('chat_message_reactions') as any)
    .select('id, message_id, user_id, emoji, created_at')
    .in('message_id', messageIds)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ChatMessageReaction[];
}

export async function toggleChatReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<{ action: 'added'; reaction: ChatMessageReaction } | { action: 'removed' }> {
  const { data: existingReaction, error: existingError } = await (supabase
    .from('chat_message_reactions') as any)
    .select('id')
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingReaction?.id) {
    const { error: deleteError } = await (supabase
      .from('chat_message_reactions') as any)
      .delete()
      .eq('id', existingReaction.id);

    if (deleteError) {
      throw deleteError;
    }

    return { action: 'removed' };
  }

  const { data, error } = await (supabase
    .from('chat_message_reactions') as any)
    .insert({
      message_id: messageId,
      user_id: userId,
      emoji,
    })
    .select('id, message_id, user_id, emoji, created_at')
    .single();

  if (error) {
    throw error;
  }

  return { action: 'added', reaction: data as ChatMessageReaction };
}
