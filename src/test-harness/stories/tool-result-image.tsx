import { ToolResultImagePreview } from '../../components/Chat/ToolResultImagePreview';

// A visible solid-red square as an inline data URI (no window.sai needed).
const RED_SQUARE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%23e0392b'/%3E%3C/svg%3E";

function ToolResultImageHarness({ variant }: { variant: string }) {
  if (variant === 'missing') {
    return <ToolResultImagePreview image={{ filePath: '/nope/missing.png' }} />;
  }
  return <ToolResultImagePreview image={{ dataUrl: RED_SQUARE }} />;
}

export const toolResultImageStory = {
  component: ToolResultImageHarness,
  parseProps: (params: URLSearchParams) => ({ variant: params.get('variant') ?? 'dataurl' }),
};
