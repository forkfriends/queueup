import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF9FA' },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 20,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e6e6e6',
    padding: 20,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 14,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  textArea: {
    height: 100,
  },
  button: {
    marginTop: 18,
    backgroundColor: '#222',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  resultCard: {
    marginTop: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d6d6d6',
    padding: 18,
    backgroundColor: '#f7f7f7',
  },
  resultHeading: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  resultLine: {
    fontSize: 16,
    marginBottom: 6,
  },
  resultCode: {
    fontWeight: '700',
  },
  resultHint: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
  },
  hostButton: {
    marginTop: 16,
    backgroundColor: '#1f6feb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default styles;
