import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  dashboardCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dfe5fb',
    backgroundColor: '#f7f9ff',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    marginTop: 16,
  },
  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 12,
  },
  dashboardHeaderText: {
    flex: 1,
    gap: 4,
  },
  dashboardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  dashboardSubtitle: {
    fontSize: 15,
    color: '#333',
  },
  dashboardConnection: {
    fontSize: 13,
    color: '#5f6b94',
  },
  leaveButton: {
    backgroundColor: '#c1121f',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveButtonDisabled: {
    opacity: 0.6,
  },
  leaveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  queueStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e5ff',
  },
  queueStat: {
    flex: 1,
    alignItems: 'center',
  },
  queueStatLabel: {
    fontSize: 13,
    color: '#57607a',
  },
  queueStatValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 4,
  },
  queueStatDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#e0e5ff',
  },
  timerCard: {
    marginTop: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d9e2ff',
    backgroundColor: '#f1f5ff',
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  timerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  timerHint: {
    fontSize: 13,
    color: '#444',
    textAlign: 'center',
  },
  presenceCard: {
    marginTop: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e3e3e3',
    backgroundColor: '#fff',
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  presenceTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  presenceHint: {
    fontSize: 13,
    color: '#555',
    marginBottom: 4,
  },
  presenceDescription: {
    fontSize: 14,
    color: '#444',
    marginBottom: 12,
  },
  locationEnableButton: {
    borderWidth: 1,
    borderColor: '#1f6feb',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  locationEnableButtonActive: {
    backgroundColor: 'rgba(31,111,235,0.08)',
  },
  locationEnableText: {
    color: '#1f6feb',
    fontSize: 15,
    fontWeight: '600',
  },
  presenceStatus: {
    fontSize: 14,
    color: '#111',
  },
  declareButton: {
    marginTop: 12,
    backgroundColor: '#1f6feb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declareButtonDisabled: {
    opacity: 0.4,
  },
  declareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  presenceFootnote: {
    marginTop: 10,
    fontSize: 13,
    color: '#555',
  },
  queueCard: {
    marginTop: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e7e7e7',
    backgroundColor: '#fff',
    padding: 16,
  },
  queueTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 8,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  queueRowSelf: {
    backgroundColor: 'rgba(31,111,235,0.08)',
    borderRadius: 10,
    paddingHorizontal: 6,
  },
  queueRowCalled: {
    borderLeftWidth: 3,
    borderLeftColor: '#1f6feb',
    paddingLeft: 8,
  },
  queuePosition: {
    width: 28,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    color: '#1f1f1f',
  },
  queueRowInfo: {
    flex: 1,
  },
  queueRowName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  queueRowMeta: {
    fontSize: 13,
    color: '#555',
    marginTop: 2,
  },
});

export default styles;
