import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';

export interface ModalButton {
  text: string;
  onPress: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface ModalOptions {
  title: string;
  message: string;
  buttons?: ModalButton[];
}

interface ModalContextType {
  showModal: (options: ModalOptions) => void;
  hideModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return context;
}

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [modalOptions, setModalOptions] = useState<ModalOptions | null>(null);

  const showModal = useCallback((options: ModalOptions) => {
    setModalOptions(options);
    setModalVisible(true);
  }, []);

  const hideModal = useCallback(() => {
    setModalVisible(false);
    // Clear options after animation
    setTimeout(() => setModalOptions(null), 200);
  }, []);

  const handleButtonPress = useCallback((button: ModalButton) => {
    button.onPress();
    hideModal();
  }, [hideModal]);

  return (
    <ModalContext.Provider value={{ showModal, hideModal }}>
      {children}
      {modalOptions && (
        <Modal
          visible={modalVisible}
          transparent
          animationType="fade"
          onRequestClose={hideModal}>
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{modalOptions.title}</Text>
              <Text style={styles.modalMessage}>{modalOptions.message}</Text>
              <View style={styles.modalActions}>
                {modalOptions.buttons && modalOptions.buttons.length > 0 ? (
                  modalOptions.buttons.map((button, index) => (
                    <Pressable
                      key={index}
                      style={[
                        styles.modalButton,
                        button.style === 'destructive' && styles.modalButtonDestructive,
                        button.style === 'cancel' && styles.modalButtonCancel,
                      ]}
                      onPress={() => handleButtonPress(button)}>
                      <Text
                        style={[
                          styles.modalButtonText,
                          button.style === 'destructive' && styles.modalButtonTextDestructive,
                          button.style === 'cancel' && styles.modalButtonTextCancel,
                        ]}>
                        {button.text}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Pressable style={styles.modalButton} onPress={hideModal}>
                    <Text style={styles.modalButtonText}>OK</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}
    </ModalContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    backgroundColor: '#fff',
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#111',
  },
  modalMessage: {
    fontSize: 15,
    color: '#444',
    lineHeight: 21,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#111',
    minWidth: 80,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  modalButtonDestructive: {
    backgroundColor: '#c1121f',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  modalButtonTextCancel: {
    color: '#333',
  },
  modalButtonTextDestructive: {
    color: '#fff',
  },
});

