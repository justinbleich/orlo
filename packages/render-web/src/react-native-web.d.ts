declare module "react-native-web" {
  export * from "react-native";
}

declare module "react-native" {
  import type { ComponentType, ReactNode } from "react";

  export type ImageSourcePropType =
    | { uri: string }
    | number
    | Array<{ uri: string }>;

  type Style = Record<string, unknown>;

  export const View: ComponentType<{ style?: Style; children?: ReactNode }>;

  export const Text: ComponentType<{
    style?: Style;
    numberOfLines?: number;
    children?: ReactNode;
  }>;

  export const Image: ComponentType<{
    source?: ImageSourcePropType;
    style?: Style;
    resizeMode?: string;
  }>;

  export const Pressable: ComponentType<{ style?: Style; children?: ReactNode }>;

  export const ScrollView: ComponentType<{
    style?: Style;
    horizontal?: boolean;
    children?: ReactNode;
  }>;

  export const TextInput: ComponentType<{
    style?: Style;
    placeholder?: string;
    defaultValue?: string;
    value?: string;
    editable?: boolean;
    secureTextEntry?: boolean;
  }>;
}
