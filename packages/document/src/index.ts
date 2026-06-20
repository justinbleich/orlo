export type {
  RNPrimitive,
  NodeId,
  Annotation,
  DesignMeta,
  Node,
  ContainerNode,
  ViewNode,
  TextNode,
  ImageNode,
  PressableNode,
  ScrollViewNode,
  TextInputNode,
  FlatListNode,
  ViewProps,
  TextProps,
  ImageProps,
  ImageSource,
  PressableProps,
  ScrollViewProps,
  TextInputProps,
  FlatListProps,
  PropsByType,
  AnyProps,
} from "./types";
export { canHaveChildren, isContainer, childrenOf } from "./types";

export {
  createNode,
  findNode,
  getParent,
  insertChild,
  removeNode,
  moveNode,
  reorderChild,
  updateProps,
  updateStyle,
  updateDesign,
  type CreateNodeInit,
} from "./tree";

export {
  validateProps,
  validateNode,
  validateTree,
  type PropError,
  type NodeError,
} from "./validate";

export { useDocumentStore, type DocumentState, type Roots } from "./store";

export { sampleDocument, FIXTURE_IMAGE_URI } from "./sample";
