module.exports = {
  name: 'ChitChat',
  plugins: [
    'expo-asset'
  ],
  expo: {
    name: "ChitChat",
    slug: "ChitChat",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "chitchat",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#282828"
    },
    assetBundlePatterns: [
      "**/*",
      "assets/audioForAnimation/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.anonymous.chitchat",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription: "This app needs access to your photo library so you can select and share photos with your friends.",
        NSCameraUsageDescription: "This app needs access to your camera so you can take and share photos or videos with your friends.",
        NSSpeechRecognitionUsageDescription: "This app needs access to speech recognition to enable voice messaging and voice features."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#282828"
      },
      package: "com.chitchat.app"
    },
    web: {
      bundler: "metro",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router"
    ],
    experiments: {
      typedRoutes: true
    },
    extra: {
      API_URL: process.env.API_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      eas: {
        projectId: "b91e3bd0-7606-41cd-afb7-e2a7f6e83fc7"
      }
    }
  }
}; 