/// <reference types="vite/client" />

/** webview_flutter JavaScript channel */
interface GameBridgeChannel {
	postMessage(message: string): void;
}

/** flutter_inappwebview handler bridge */
interface FlutterInAppWebViewBridge {
	callHandler(
		handlerName: string,
		...args: unknown[]
	): Promise<unknown>;
}

interface Window {
	GameBridge?: GameBridgeChannel;
	flutter_inappwebview?: FlutterInAppWebViewBridge;
}
