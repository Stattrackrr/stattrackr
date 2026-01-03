'use client';

interface ProfileAvatarProps {
  username: string | null;
  userEmail: string | null;
  avatarUrl: string | null;
}

export function ProfileAvatar({ username, userEmail, avatarUrl }: ProfileAvatarProps) {
  const displayName = username || userEmail || 'Profile';
  const fallbackInitial = displayName?.trim().charAt(0)?.toUpperCase() || 'P';
  
  const getAvatarColor = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const saturation = 65 + (Math.abs(hash) % 20);
    const lightness = 45 + (Math.abs(hash) % 15);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };
  
  const avatarColor = !avatarUrl ? getAvatarColor(displayName) : undefined;
  
  return (
    <div 
      className="w-6 h-6 rounded-full overflow-hidden border border-gray-300 dark:border-gray-600 flex items-center justify-center text-xs font-semibold text-white"
      style={avatarColor ? { backgroundColor: avatarColor } : { backgroundColor: 'rgb(243, 244, 246)' }}
    >
      {avatarUrl ? (
        <img src={avatarUrl ?? undefined} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span className="flex items-center justify-center w-full h-full">{fallbackInitial}</span>
      )}
    </div>
  );
}

