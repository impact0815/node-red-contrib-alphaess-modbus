'use strict';
/**
 * Publishes to MQTT through an existing Node-RED "mqtt-broker" config node
 * (core node), so no own MQTT client and no additional dependency is needed.
 *
 * Note: register()/publish()/deregister() are used by the core MQTT nodes but
 * are not a documented public API.
 */

const LIVE_KEYS = ['consumption', 'grid', 'modules', 'battery', 'soc', 'gridImport', 'gridExport',
	'batteryCharge', 'batteryDischarge', 'autarky', 'selfConsumptionRate'];

const bool = (v) => v === true || v === 'true';

class MqttPublisher {
	constructor(RED, node, config) {
		this.broker = null;
		this.node = node;
		const id = config.mqttBroker;
		if (!id || id === '_ADD_') return;
		const broker = RED.nodes.getNode(id);
		if (!broker || typeof broker.publish !== 'function' || typeof broker.register !== 'function') {
			node.warn('MQTT broker not found or not compatible – MQTT publishing disabled');
			return;
		}
		this.broker = broker;
		this.prefix = String(config.mqttPrefix || 'alphaess').replace(/\/+$/, '');
		this.retain = bool(config.mqttRetain);
		this.qos = [0, 1, 2].includes(Number(config.mqttQos)) ? Number(config.mqttQos) : 0;
		this.details = bool(config.mqttDetails);
		// The broker updates the status of all registered users on (dis)connect.
		// A proxy keeps the status of our node untouched.
		this.user = { id: node.id + ':mqtt', status: () => {} };
		broker.register(this.user);
	}

	get enabled() {
		return !!this.broker;
	}

	publish(topic, value, retain) {
		if (!this.broker || value === undefined || value === null) return;
		const payload = typeof value === 'object' ? JSON.stringify(value) : String(value);
		try {
			this.broker.publish({
				topic: `${this.prefix}/${topic}`,
				payload,
				qos: this.qos,
				retain: retain === undefined ? this.retain : retain
			});
		} catch (err) {
			this.node.debug(`MQTT publish failed: ${err.message}`);
		}
	}

	/** publish one poll cycle; alarm is only given when it changed */
	publishCycle(payload, alarm) {
		if (!this.broker) return;
		LIVE_KEYS.forEach((k) => this.publish(k, payload[k]));
		if (payload.daily) {
			Object.keys(payload.daily).forEach((k) => {
				if (k !== 'day' && k !== 'since') this.publish(`daily/${k}`, payload.daily[k]);
			});
		}
		this.publish('status', payload.alarms.length ? 'alarm' : 'ok');
		if (alarm) this.publish('alarm', alarm);
		if (this.details) Object.keys(payload.details).forEach((b) => this.publish(`details/${b}`, payload.details[b]));
	}

	close(done) {
		if (!this.broker) return done();
		try {
			this.broker.deregister(this.user, done, true);
		} catch (err) {
			done();
		}
	}
}

module.exports = { MqttPublisher, LIVE_KEYS };
