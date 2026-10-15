import { supabase } from '@/lib/supabaseClient';

export const CHAT_MESSAGE_LIMIT = 50;
export const CHAT_MAX_MESSAGE_LENGTH = 1500;
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
  pinned_at: string | null;
  pinned_by: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  /** Admin-only photo in the public chat-images bucket. */
  image_url: string | null;
};

export const CHAT_IMAGE_BUCKET = 'chat-images';
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type ChatMessageReaction = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

const CHAT_MESSAGE_BASE_SELECT =
  'id, room_id, user_id, body, display_name, avatar_url, reply_to_message_id, created_at, updated_at, deleted_at, deleted_by';
const CHAT_MESSAGE_PIN_SELECT =
  'id, room_id, user_id, body, display_name, avatar_url, reply_to_message_id, pinned_at, pinned_by, edited_at, created_at, updated_at, deleted_at, deleted_by';
const CHAT_MESSAGE_IMAGE_SELECT = `${CHAT_MESSAGE_PIN_SELECT}, image_url`;
/** Newest schema first; each step drops columns a database without the later migrations lacks. */
const CHAT_MESSAGE_SELECTS = [CHAT_MESSAGE_IMAGE_SELECT, CHAT_MESSAGE_PIN_SELECT, CHAT_MESSAGE_BASE_SELECT];

function isMissingPinnedColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: string; message?: string; details?: string; hint?: string };
  const combinedText = [maybeError.message, maybeError.details, maybeError.hint].filter(Boolean).join(' ').toLowerCase();

  return (
    maybeError.code === '42703' ||
    maybeError.code === 'PGRST204' ||
    maybeError.code === 'PGRST205' ||
    combinedText.includes('pinned_at') ||
    combinedText.includes('pinned_by') ||
    combinedText.includes('edited_at') ||
    combinedText.includes('image_url') ||
    combinedText.includes('schema cache')
  );
}

async function selectWithFallback(
  run: (select: string) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<{ data: unknown; select: string }> {
  let lastError: unknown = null;
  for (const select of CHAT_MESSAGE_SELECTS) {
    const { data, error } = await run(select);
    if (!error) return { data, select };
    if (!isMissingPinnedColumnError(error)) throw error;
    lastError = error;
  }
  throw lastError;
}

function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    pinned_at: message.pinned_at ?? null,
    pinned_by: message.pinned_by ?? null,
    edited_at: message.edited_at ?? null,
    image_url: message.image_url ?? null,
  }));
}

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
  const { data, select } = await selectWithFallback((columns) =>
    (supabase.from('chat_messages') as any)
      .select(columns)
      .eq('room_id', roomId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit)
  );

  if (select === CHAT_MESSAGE_BASE_SELECT) {
    return normalizeChatMessages(((data ?? []) as ChatMessage[]).reverse());
  }

  const { data: pinnedData, error: pinnedError } = await (supabase
    .from('chat_messages') as any)
    .select(select)
    .eq('room_id', roomId)
    .is('deleted_at', null)
    .not('pinned_at', 'is', null)
    .order('pinned_at', { ascending: false });

  if (pinnedError) {
    if (isMissingPinnedColumnError(pinnedError)) {
      return normalizeChatMessages(((data ?? []) as ChatMessage[]).reverse());
    }

    throw pinnedError;
  }

  const messageMap = new Map<string, ChatMessage>();

  for (const message of normalizeChatMessages((data ?? []) as ChatMessage[])) {
    messageMap.set(message.id, message);
  }

  for (const message of normalizeChatMessages((pinnedData ?? []) as ChatMessage[])) {
    messageMap.set(message.id, message);
  }

  return Array.from(messageMap.values()).sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
}

export async function sendChatMessage(
  roomId: string,
  body: string,
  replyToMessageId?: string | null,
  imageUrl?: string | null
): Promise<ChatMessage> {
  const row: Record<string, unknown> = {
    room_id: roomId,
    body: body.trim(),
    reply_to_message_id: replyToMessageId ?? null,
  };
  if (imageUrl) row.image_url = imageUrl;
  const { data } = await selectWithFallback((columns) =>
    (supabase.from('chat_messages') as any).insert(row).select(columns).single()
  );
  return normalizeChatMessages([data as ChatMessage])[0];
}

/** Admin only: storage policies reject anyone else. Returns the public URL to send with the message. */
export async function uploadChatImage(file: File, userId: string): Promise<string> {
  if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Photos must be PNG, JPG, WebP or GIF.');
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('Photos must be 5MB or smaller.');
  }
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage
    .from(CHAT_IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return supabase.storage.from(CHAT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
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

export async function editChatMessage(messageId: string, body: string): Promise<ChatMessage> {
  const { data, error } = await ((supabase as any).rpc('edit_chat_message', {
    target_message_id: messageId,
    next_body: body.trim(),
  }) as any);

  if (error) {
    throw error;
  }

  return normalizeChatMessages([data as ChatMessage])[0];
}

export async function toggleChatMessagePin(messageId: string): Promise<ChatMessage> {
  const { data, error } = await ((supabase as any).rpc('toggle_chat_message_pin', {
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
