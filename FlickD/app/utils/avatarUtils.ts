export const getAvatarColor = (userId: string): string => {
  const colors = [
    '#DC2626', // Deep Red
    '#059669', // Deep Green
    '#1D4ED8', // Deep Blue
    '#7C2D12', // Deep Brown
    '#6B21A8', // Deep Purple
    '#BE185D', // Deep Pink
    '#0F766E', // Deep Teal
    '#B45309', // Deep Orange
    '#374151', // Deep Gray
    '#1F2937', // Deep Slate
    '#0E7490', // Deep Cyan
    '#A21CAF', // Deep Magenta
  ];
  const index = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
  return colors[index];
};

export const getInitials = (name: string): string => {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

export const getAvatarStyle = (userId: string, size: number = 40) => ({
  width: size,
  height: size,
  borderRadius: size / 2,
  backgroundColor: getAvatarColor(userId),
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  borderWidth: 2,
  borderColor: 'rgba(255, 255, 255, 0.3)',
});

export const getAvatarTextStyle = (size: number = 40) => ({
  color: '#FFFFFE',
  fontSize: Math.max(12, size * 0.3),
  fontWeight: 'bold' as const,
  textShadowColor: 'rgba(0,0,0,0.3)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2,
}); 