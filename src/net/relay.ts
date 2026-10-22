// Fan-out over several free public MQTT brokers (WebSocket/TLS). Every message is sent
// through all connected brokers and receivers de-duplicate, so the game keeps running
// when one broker is slow or down, and players on different networks can reach each other.

import mqtt, { type MqttClient } from 'mqtt';

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export const TOPIC_ROOT = 'pocketpoker/v1';

export class Relay {
  private clients: MqttClient[] = [];
  private topics = new Set<string>();
  private connected = new Set<number>();

  constructor(
    private onMessage: (topic: string, payload: string) => void,
    private onStatus: (connected: number) => void = () => {},
  ) {
    BROKERS.forEach((url, i) => {
      const c = mqtt.connect(url, {
        clientId: 'pkp_' + Math.random().toString(36).slice(2, 12),
        connectTimeout: 8000,
        reconnectPeriod: 2500,
        keepalive: 20,
        clean: true,
      });
      c.on('connect', () => {
        this.connected.add(i);
        this.onStatus(this.connected.size);
        if (this.topics.size) c.subscribe([...this.topics], { qos: 1 });
      });
      c.on('close', () => {
        if (this.connected.delete(i)) this.onStatus(this.connected.size);
      });
      c.on('error', () => {});
      c.on('message', (topic, payload) => this.onMessage(topic, payload.toString()));
      this.clients.push(c);
    });
  }

  get connectedCount() {
    return this.connected.size;
  }

  subscribe(topic: string) {
    this.topics.add(topic);
    this.clients.forEach((c, i) => this.connected.has(i) && c.subscribe(topic, { qos: 1 }));
  }

  publish(topic: string, payload: string, retain = false) {
    this.clients.forEach((c, i) => {
      if (this.connected.has(i)) c.publish(topic, payload, { qos: 1, retain });
    });
  }

  /** Publish a message to brokers as they connect (for retained room info). */
  publishWhenReady(topic: string, payload: string, retain = false) {
    this.clients.forEach((c, i) => {
      if (this.connected.has(i)) c.publish(topic, payload, { qos: 1, retain });
      else c.once('connect', () => c.publish(topic, payload, { qos: 1, retain }));
    });
  }

  /** Force reconnects, e.g. after the phone wakes up. */
  nudge() {
    this.clients.forEach((c) => {
      if (!c.connected && !c.disconnecting) c.reconnect();
    });
  }

  end() {
    this.clients.forEach((c) => c.end(true));
    this.clients = [];
  }

  /** Clear a retained message on every broker, then close. */
  async clearAndEnd(topic: string) {
    await Promise.all(
      this.clients.map(
        (c) =>
          new Promise<void>((res) => {
            if (!c.connected) return res();
            c.publish(topic, '', { qos: 1, retain: true }, () => res());
            setTimeout(res, 1500);
          }),
      ),
    );
    this.end();
  }
}
