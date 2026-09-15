import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { examFetch } from '../../services/api';

export function TeacherQrScanner({ route, navigation }: { route: any; navigation: any }) {
  const { examId, title } = route.params;

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission]);

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (scanned || verifying) return;
    setScanned(true);
    setVerifying(true);

    try {
      // Parse QR payload
      const qrData = JSON.parse(data);

      if (!qrData.student_id || !qrData.uid || !qrData.qr_token || !qrData.device_id) {
        throw new Error('Invalid QR payload format');
      }

      // Verify on server
      await examFetch(`/exams/${examId}/gate/verify-qr`, {
        method: 'POST',
        body: JSON.stringify({
          student_id: qrData.student_id,
          uid: qrData.uid,
          device_id: qrData.device_id,
          qr_token: qrData.qr_token,
        }),
      });

      Alert.alert(
        'Verified ✅',
        `Student UID: ${qrData.uid} has been checked in successfully!`,
        [{ text: 'Scan Next', onPress: () => { setScanned(false); setVerifying(false); } }]
      );

    } catch (err: any) {
      Alert.alert(
        'Scan Error ❌',
        err.message || 'Failed to verify QR token with server.',
        [{ text: 'Retry', onPress: () => { setScanned(false); setVerifying(false); } }]
      );
    }
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>Camera permissions are required to scan student QRs.</Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan Entry QR</Text>
        <Text style={styles.headerSubtitle}>{title}</Text>
      </View>

      <View style={styles.cameraContainer}>
        {!scanned && (
          <CameraView
            style={StyleSheet.absoluteFillObject}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={handleBarCodeScanned}
          />
        )}

        {verifying && (
          <View style={styles.verifyingOverlay}>
            <ActivityIndicator size="large" color="#F8FAFC" />
            <Text style={styles.verifyingText}>Verifying credentials with server...</Text>
          </View>
        )}

        <View style={styles.overlayFrame}>
          <View style={styles.scannerCutout} />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Align student waiting room QR inside the frame</Text>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.closeBtnText}>Done Scanning</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    padding: 20,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  cameraContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  overlayFrame: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  scannerCutout: {
    width: 260,
    height: 260,
    borderWidth: 2,
    borderColor: '#3B82F6',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  verifyingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  verifyingText: {
    color: '#F8FAFC',
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  footerText: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  closeBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 20,
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 12,
    fontSize: 16,
  },
  permissionText: {
    color: '#94A3B8',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  permissionBtnText: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
});
