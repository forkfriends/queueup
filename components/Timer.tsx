import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';

export default function Timer() {
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);

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

  // Timer countdown effect
  useEffect(() => {
    if (!running) return;
    if (remaining <= 0) {
      setRunning(false);
      alert('Time is up!');
      return;
    }
    const interval = setInterval(() => setRemaining(r => r - 1), 1000);
    return () => clearInterval(interval);
  }, [running, remaining]);

  // Convert remaining seconds → H:M:S format
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 }}>
      {!running ? (
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
      ) : (
        <Text style={{ fontSize: 40, fontWeight: 'bold' }}>
          {`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s
            .toString()
            .padStart(2, '0')}`}
        </Text>
      )}
    </View>
  );
}
