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
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
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
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  logoIcon: {
    width: 128,
    height: 128,
    marginRight: 16,
  },
  title: {
    fontSize: 56,
    fontWeight: '700',
    lineHeight: 40,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 20,
  },
  button: {
    backgroundColor: '#111',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
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
    fontSize: 14,
    fontWeight: '600',
  },
  joinedButton: {
    marginTop: 20,
    width: '100%',
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#2ea44f',
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonSpacing: {
    marginTop: 10,
  },
  sectionContainer: {
    width: '100%',
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
    textAlign: 'left',
    width: '100%',
  },
  privacyLink: {
    marginTop: 32,
    fontSize: 12,
    color: '#555',
    textDecorationLine: 'underline',
  },
});
