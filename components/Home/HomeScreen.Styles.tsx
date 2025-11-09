import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF9FA' },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    alignItems: 'center',
  },
  returnButton: {
    marginTop: 20,
    width: '100%',
    backgroundColor: '#2ea44f', // Different color to distinguish it
    padding: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  returnButtonSpacing: {
    marginTop: 10, // Less spacing between multiple return buttons
  },
  title: {
    marginTop: 24,
    marginBottom: 24,
    textAlign: 'center',
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 40,
  },
  logo: {
    width: '90%',
    height: 260,
    marginBottom: 32,
    borderRadius: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 20,
  },
  button: {
    backgroundColor: '#222',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 140,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  joinedButton: {
    marginTop: 20,
    width: '100%',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#2ea44f',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  joinedButtonText: {
    color: '#2ea44f',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonSpacing: {
    marginTop: 10,
  },
});
