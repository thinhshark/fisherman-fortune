/**
 * Intent for the next Level.create() after scene.restart().
 * Default is Home ready state; Play Again boots straight into gameplay.
 */
export type LevelBootIntent = "home" | "playAgain";

let pendingIntent: LevelBootIntent = "home";

export function setLevelBootIntent(intent: LevelBootIntent): void {
	pendingIntent = intent;
}

export function consumeLevelBootIntent(): LevelBootIntent {
	const intent = pendingIntent;
	pendingIntent = "home";
	return intent;
}
