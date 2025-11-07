import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';

interface TimerProps {
  initialSeconds?: number | null;
  autoStart?: boolean;
  showInputs?: boolean;
  onComplete?: () => void;
}

export default function Timer({
  initialSeconds = null,
  autoStart = true,
  showInputs = true,
  onComplete,
}: TimerProps) {
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const controlled = typeof initialSeconds === 'number' && initialSeconds >= 0;
  const shouldShowInputs = showInputs && !controlled;

  // Convert user input into total seconds and start countdown
  const startTimer = () => {
    const total =
      (parseInt(hours || '0') * 3600) +
      (parseInt(minutes || '0') * 60) +
      parseInt(seconds || '0');
    if (total > 0) {
      setRemaining(total);
      setRunning(true);
    }
  };

  useEffect(() => {
    if (!controlled) {
      return;
    }
    setRemaining(initialSeconds ?? 0);
    setRunning(autoStart);
  }, [controlled, initialSeconds, autoStart]);

  // Timer countdown effect
  useEffect(() => {
    if (!running) return;
    if (remaining <= 0) {
      setRunning(false);
      if (!controlled) {
        Alert.alert('Time is up!', 'Timer finished.');
      }
      onComplete?.();
      return;
    }
    const interval = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(interval);
  }, [running, remaining, controlled, onComplete]);

  // Convert remaining seconds → H:M:S format
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const showCountdownText = running || controlled;

  return (
    <View style={{ justifyContent: 'center', alignItems: 'center', gap: 10 }}>
      {!running && shouldShowInputs ? (
        <>
          <TextInput
            placeholder="Hours"
            value={hours}
            onChangeText={setHours}
            keyboardType="numeric"
            style={{ borderWidth: 1, padding: 8, width: 100, textAlign: 'center' }}
          />
          <TextInput
            placeholder="Minutes"
            value={minutes}
            onChangeText={setMinutes}
            keyboardType="numeric"
            style={{ borderWidth: 1, padding: 8, width: 100, textAlign: 'center' }}
          />
          <TextInput
            placeholder="Seconds"
            value={seconds}
            onChangeText={setSeconds}
            keyboardType="numeric"
            style={{ borderWidth: 1, padding: 8, width: 100, textAlign: 'center' }}
          />
          <Button title="Start Timer" onPress={startTimer} />
        </>
      ) : null}
      {showCountdownText ? (
        <Text style={{ fontSize: 40, fontWeight: 'bold' }}>
          {`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s
            .toString()
            .padStart(2, '0')}`}
        </Text>
      ) : null}
    </View>
  );
}
