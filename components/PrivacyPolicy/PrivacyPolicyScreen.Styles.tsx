import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FAF9FA',
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  subtitleSpacing: {
    marginTop: 4,
  },
  paragraph: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 22,
    color: '#333333',
  },
  section: {
    marginTop: 24,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    textDecorationLine: 'underline',
  },
  bulletList: {
    marginTop: 8,
    paddingLeft: 16,
  },
  bulletItem: {
    fontSize: 14,
    lineHeight: 22,
    color: '#333333',
  },
  link: {
    color: '#2563EB',
    textDecorationLine: 'underline',
  },
});

export default styles;
