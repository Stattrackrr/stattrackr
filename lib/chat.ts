import { supabase } from '@/lib/supabaseClient';

export const CHAT_MESSAGE_LIMIT = 50;
export const CHAT_MAX_MESSAGE_LENGTH = 500;

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
