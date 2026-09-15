import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

interface Props {
  visible: boolean;
  uri: string | null;
  token?: string | null;
  onClose: () => void;
}

/**
 * Full-screen image viewer with pinch-to-zoom and pan, matching the original
 * exam app's "open in big" behaviour. The exam media endpoints require a Bearer
 * token, which a plain <img src> inside a WebView can't carry — so we download
 * the image (with auth) to base64 and embed it in an HTML wrapper whose viewport
 * meta enables native pinch-zoom + pan on both Android and iOS. No extra native
 * dependency (the app already ships react-native-webview).
 */
export function FullScreenImageViewer({ visible, uri, token, onClose }: Props) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || !uri) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setDataUri(null);

    (async () => {
      try {
        // Already a local file (pre-downloaded during "Get") → read it directly,
        // no network / auth needed. Otherwise fetch from the server with the token.
        let localPath = uri;
        if (!uri.startsWith('file://')) {
          const target = `${FileSystem.cacheDirectory}zoom_${Math.abs(hashCode(uri))}.img`;
          const res = await FileSystem.downloadAsync(uri, target, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (res.status !== 200) throw new Error(`status ${res.status}`);
          localPath = res.uri;
        }
        const b64 = await FileSystem.readAsStringAsync(localPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (cancelled) return;
        setDataUri(`data:image/jpeg;base64,${b64}`);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, uri, token]);

  const html = dataUri
    ? `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
.wrap{height:100vh;display:flex;align-items:center;justify-content:center}
img{max-width:100%;max-height:100%;display:block}</style></head>
<body><div class="wrap"><img src="${dataUri}"></div></body></html>`
    : '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        {dataUri ? (
          <WebView
            originWhitelist={['*']}
            source={{ html }}
            style={styles.web}
            scalesPageToFit={false}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            javaScriptEnabled={false}
          />
        ) : (
          <View style={styles.center}>
            {loading && <ActivityIndicator size="large" color="#FFFFFF" />}
            {failed && <Text style={styles.errText}>Could not load image.</Text>}
          </View>
        )}

        <View style={styles.hintBar} pointerEvents="none">
          <Text style={styles.hintText}>Pinch to zoom · drag to pan</Text>
        </View>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errText: { color: '#FCA5A5', fontSize: 15 },
  closeBtn: {
    position: 'absolute', top: 44, right: 18,
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', lineHeight: 22 },
  hintBar: {
    position: 'absolute', bottom: 28, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  hintText: { color: '#E5E7EB', fontSize: 12 },
});
