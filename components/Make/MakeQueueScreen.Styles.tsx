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
  sliderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sliderHint: {
    fontSize: 15,
    color: '#444',
    marginRight: 6,
  },
  sliderValue: {
    fontSize: 18,
    fontWeight: '700',
    marginRight: 6,
  },
  slider: {
    marginHorizontal: 4,
  },
  textArea: {
    height: 100,
  },
  timeRow: { flexDirection: 'row' },
  timeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  timeInputLeft: {
    marginRight: 6,
  },
  timeInputRight: {
    marginLeft: 6,
  },
  timeLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  timeValue: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
  },
  timeStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeStepperButtons: {
    marginLeft: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    overflow: 'hidden',
  },
  timeStepperButton: {
    paddingVertical: 2,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  timeStepperButtonTop: {
    borderBottomWidth: 1,
    borderBottomColor: '#d0d0d0',
  },
  timeStepperButtonDisabled: {
    opacity: 0.4,
  },
  timeStepperIcon: {
    fontSize: 8,
    fontWeight: '600',
    color: '#222',
  },
  timePickerContainer: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  timePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  timePickerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  timePickerDone: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f6feb',
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
