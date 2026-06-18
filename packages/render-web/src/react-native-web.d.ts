declare module "react-native-web" {
  export * from "react-native";
}

declare module "react-native" {
  import type { ComponentType, ReactNode } from "react";

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
