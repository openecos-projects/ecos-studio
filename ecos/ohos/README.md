# HarmonyOS shell

A HarmonyOS NEXT ability that loads the ECOS Studio web build in an ArkWeb
`Web` component. It ports no rendering code: the app is the same web bundle the
browser target produces, so there is one renderer to maintain rather than one
per platform.

## Build

Requires DevEco Studio with the HarmonyOS NEXT SDK; open this directory as the
project root.

```sh
hvigorw assembleHap
```

CI does not build it — GitHub Actions has no HarmonyOS runner, and the SDK is
not redistributable.

## Pointing at a different origin

`Index.ets` reads `appUrl` from `AppStorage` and falls back to the production
URL, so a development build can be aimed at a local server without a code
change.
