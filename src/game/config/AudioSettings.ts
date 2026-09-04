/**
 * Cấu hình âm thanh trung tâm — chỉnh volume / bật tắt tại đây.
 *
 * - musicEnabled: bật nhạc nền gameplay
 * - sfxEnabled: bật hiệu ứng âm thanh
 * - gameMusicVolume: âm lượng nhạc game (0–1)
 * - musicFadeInMs: thời gian fade-in nhạc khi bắt đầu (ms)
 * - uiVolume: âm lượng UI (nút, menu)
 * - hookVolume: âm lượng tời / hook
 * - catchVolume: âm lượng khi vừa cắn câu
 * - rewardVolume: âm lượng khi giao cá/vật phẩm (tính điểm)
 * - timerVolume: âm lượng đếm ngược 10…1
 * - resultVolume: âm lượng kết thúc ván
 */

export const AudioSettings = {
	musicEnabled: true,
	sfxEnabled: true,
	gameMusicVolume: 0.32,
	musicFadeInMs: 700,
	uiVolume: 0.65,
	hookVolume: 0.55,
	catchVolume: 0.65,
	rewardVolume: 0.70,
	timerVolume: 0.60,
	resultVolume: 0.75,
} as const;

export type AudioSettingsType = typeof AudioSettings;

export const MUSIC_PREF_KEY = "fisherman-fortune-music-enabled";
export const SFX_PREF_KEY = "fisherman-fortune-sfx-enabled";
