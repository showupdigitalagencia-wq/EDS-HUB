// =============================================================================
// Block-based Email Editor Types
// =============================================================================

export type BlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'spacer';

export interface BaseBlock {
  id: string;
  type: BlockType;
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading';
  text: string;
  level: 1 | 2 | 3;
  align: 'left' | 'center' | 'right';
  color?: string;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  text: string;
  align: 'left' | 'center' | 'right';
  color?: string;
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  url: string;
  alt: string;
  width?: string;
  align: 'left' | 'center' | 'right';
}

export interface ButtonBlock extends BaseBlock {
  type: 'button';
  label: string;
  url: string;
  align: 'left' | 'center' | 'right';
  bgColor: string;
  textColor: string;
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
  color?: string;
  thickness?: number;
}

export interface SpacerBlock extends BaseBlock {
  type: 'spacer';
  height: number;
}

export type EmailBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock;
