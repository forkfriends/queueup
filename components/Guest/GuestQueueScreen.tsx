import React from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import type { QueueVenue } from '../../lib/backend';
import Timer from '../Timer';
import styles from './GuestQueueScreen.Styles';

export type GuestQueueEntry = {
  id: string;
  name?: string;
  size?: number;
  status: 'waiting' | 'called';
};

interface Props {
  partyId: string;
  resultText: string | null;
  connectionLabel: string;
  position: number | null;
  aheadCount: number | null;
  combinedQueue: GuestQueueEntry[];
  callTimerSeconds: number | null;
  callTimerKey: number;
  callWindowMinutes: number | null;
  venue: QueueVenue | null;
  distanceMeters: number | null;
  geofenceRadiusMeters: number;
  locationMonitoring: boolean;
  presenceDeclared: boolean;
  declaringPresence: boolean;
  declareDisabled: boolean;
  onLeavePress: () => void;
  leaveLoading: boolean;
  onEnableLocationPress: () => void;
  onDeclarePresence: () => void;
}

export default function GuestQueueScreen({
  partyId,
  resultText,
  connectionLabel,
  position,
  aheadCount,
  combinedQueue,
  callTimerSeconds,
  callTimerKey,
  callWindowMinutes,
  venue,
  distanceMeters,
  geofenceRadiusMeters,
  locationMonitoring,
  presenceDeclared,
  declaringPresence,
  declareDisabled,
  onLeavePress,
  leaveLoading,
  onEnableLocationPress,
  onDeclarePresence,
}: Props) {
  const distanceLabel =
    distanceMeters !== null ? `You're ${Math.max(0, Math.round(distanceMeters))}m away` : null;

  return (
    <>
      <View style={styles.dashboardCard}>
        <View style={styles.dashboardHeader}>
          <View style={styles.dashboardHeaderText}>
            <Text style={styles.dashboardTitle}>You're in line</Text>
            <Text style={styles.dashboardSubtitle}>
              {resultText ?? "We'll keep this spot updated in real time."}
            </Text>
            <Text style={styles.dashboardConnection}>{connectionLabel}</Text>
          </View>
          <Pressable
            style={[styles.leaveButton, leaveLoading ? styles.leaveButtonDisabled : undefined]}
            onPress={onLeavePress}
            disabled={leaveLoading}>
            {leaveLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.leaveButtonText}>Leave Queue</Text>
            )}
          </Pressable>
        </View>
        <View style={styles.queueStatsRow}>
          <View style={styles.queueStat}>
            <Text style={styles.queueStatLabel}>Your spot</Text>
            <Text style={styles.queueStatValue}>{position ?? '--'}</Text>
          </View>
          <View style={styles.queueStatDivider} />
          <View style={styles.queueStat}>
            <Text style={styles.queueStatLabel}>Ahead of you</Text>
            <Text style={styles.queueStatValue}>{aheadCount ?? 0}</Text>
          </View>
        </View>
      </View>

      {partyId && callTimerSeconds !== null ? (
        <View style={styles.timerCard}>
          <Text style={styles.timerTitle}>Host is ready for you</Text>
          <Timer key={callTimerKey} initialSeconds={callTimerSeconds} autoStart showInputs={false} />
          <Text style={styles.timerHint}>Check in with the host before the timer hits zero.</Text>
        </View>
      ) : null}

      {venue ? (
        <View style={styles.presenceCard}>
          <Text style={styles.presenceTitle}>Let the host know you're here</Text>
          {callWindowMinutes ? (
            <Text style={styles.presenceHint}>
              You have {callWindowMinutes} min to respond when called.
            </Text>
          ) : null}
          <Text style={styles.presenceDescription}>
            {venue.label
              ? `We'll unlock check-in once you're near ${venue.label}.`
              : "We'll unlock check-in once you're near the restaurant."}
          </Text>
          <Pressable
            style={[
              styles.locationEnableButton,
              locationMonitoring ? styles.locationEnableButtonActive : undefined,
            ]}
            onPress={onEnableLocationPress}>
            <Text style={styles.locationEnableText}>
              {locationMonitoring ? 'Location Enabled' : 'Enable Location'}
            </Text>
          </Pressable>
          <Text style={styles.presenceStatus}>
            {distanceLabel ?? (locationMonitoring ? 'Checking your distance…' : 'Location off')}
          </Text>
          <Pressable
            style={[styles.declareButton, declareDisabled ? styles.declareButtonDisabled : undefined]}
            onPress={onDeclarePresence}
            disabled={declareDisabled}>
            {declaringPresence ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.declareButtonText}>
                {presenceDeclared ? 'Presence Confirmed' : "I'm Here"}
              </Text>
            )}
          </Pressable>
          <Text style={styles.presenceFootnote}>
            {declareDisabled && !presenceDeclared
              ? `Move within ${Math.round(geofenceRadiusMeters)}m to unlock the button.`
              : 'Great! Tap the button so the host knows you are nearby.'}
          </Text>
        </View>
      ) : null}

      {combinedQueue.length > 0 ? (
        <View style={styles.queueCard}>
          <Text style={styles.queueTitle}>Queue Overview</Text>
          {combinedQueue.map((party, index) => {
            const isSelf = party.id === partyId;
            const isServing = party.status === 'called';
            const displayName = party.name?.trim() ? party.name.trim() : 'Guest';
            return (
              <View
                key={`${party.id}-${index}`}
                style={[
                  styles.queueRow,
                  isSelf ? styles.queueRowSelf : undefined,
                  isServing ? styles.queueRowCalled : undefined,
                ]}>
                <Text style={styles.queuePosition}>{index + 1}</Text>
                <View style={styles.queueRowInfo}>
                  <Text style={styles.queueRowName}>
                    {displayName}
                    {isSelf ? ' (You)' : ''}
                  </Text>
                  <Text style={styles.queueRowMeta}>
                    {isServing ? 'With host' : 'Waiting'}
                    {party.size ? ` · Party of ${party.size}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </>
  );
}
