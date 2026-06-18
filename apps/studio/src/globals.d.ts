declare module "react-native-web" {
  export * from "react-native";
}

declare module "pngjs" {
  export class PNG {
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer): PNG;
    };
  }
}

declare module "react-native" {
  import type { ComponentType, ReactNode } from "react";

  export const AppRegistry: {
    registerComponent(name: string, component: () => ComponentType): void;
  };

  export type ImageSourcePropType =
    | { uri: string }
    | number
    | Array<{ uri: string }>;

  export const View: ComponentType<{
    style?: Record<string, unknown>;
    children?: ReactNode;
  }>;

  export const Text: ComponentType<{
    style?: Record<string, unknown>;
    children?: ReactNode;
  }>;

  export const Image: ComponentType<{
    source?: ImageSourcePropType;
    style?: Record<string, unknown>;
    resizeMode?: string;
  }>;
}
