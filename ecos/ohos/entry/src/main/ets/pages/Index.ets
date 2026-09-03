import { webview } from '@kit.ArkWeb'

// The app itself is the existing web build; this ability only hosts it, so the
// renderer stays in one place instead of being ported per platform.
const DEFAULT_URL: string = 'https://ecos.studio'

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController()

  build() {
    Web({ src: AppStorage.get<string>('appUrl') ?? DEFAULT_URL, controller: this.controller })
      .width('100%')
      .height('100%')
      .javaScriptAccess(true)
      .domStorageAccess(true)
  }
}
