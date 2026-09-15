import React, { useRef, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { FullScreenImageViewer } from './FullScreenImageViewer';

interface Props {
  uri: string;
  token?: string | null;
  /** Horizontal space the image may occupy (defaults to ~screen width minus card padding). */
  containerWidth?: number;
  /** Natural pixel dims if known — used to preserve aspect ratio. */
  naturalWidth?: number | null;
  naturalHeight?: number | null;
  /** Hard cap on inline height so very tall images don't dominate the screen. */
  maxHeight?: number;
}

const DOUBLE_TAP_MS = 280;

/**
 * Inline question/solution image that scales to the device width and opens a
 * full-screen pinch-to-zoom viewer on DOUBLE TAP — mirroring the original exam
 * app. Drop-in replacement for a plain <Image>.
 */
export function ZoomableImage({
  uri,
  token,
  containerWidth,
  naturalWidth,
  naturalHeight,
  maxHeight,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    naturalWidth && naturalHeight ? { w: naturalWidth, h: naturalHeight } : null,
  );
  const lastTap = useRef(0);

  // Responsive sizing: fill the available width, preserve aspect ratio, cap height.
  const availWidth = containerWidth ?? screenWidth - 56;
  const cap = maxHeight ?? Math.round(screenWidth * 1.15);
  const aspect = natural ? natural.w / natural.h : 16 / 10;
  let w = availWidth;
  let h = w / aspect;
  if (h > cap) {
    h = cap;
    w = Math.min(availWidth, h * aspect);
  }

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      setViewerOpen(true);
    } else {
      lastTap.current = now;
    }
  };

  return (
    <>
      <TouchableWithoutFeedback onPress={handleTap} accessibilityLabel="Double-tap to zoom image">
        <View style={[styles.wrap, { width: w, height: h }]}>
          <Image
            source={{
              uri,
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            }}
            style={{ width: w, height: h, borderRadius: 8 }}
            resizeMode="contain"
            resizeMethod="resize"
            fadeDuration={0}
            onLoad={(e) => {
              const src = (e?.nativeEvent as any)?.source;
              if (src?.width && src?.height && !natural) {
                setNatural({ w: src.width, h: src.height });
              }
            }}
          />
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>⤢ double-tap</Text>
          </View>
        </View>
      </TouchableWithoutFeedback>

      <FullScreenImageViewer
        visible={viewerOpen}
        uri={uri}
        token={token}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#F0F5F2', borderRadius: 8, overflow: 'hidden' },
  hint: {
    position: 'absolute', right: 6, bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  hintText: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },
});
