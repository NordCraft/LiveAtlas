/*
 * Copyright 2022 James Lyne
 *
 * Some portions of this file were taken from https://github.com/webbukkit/dynmap.
 * These portions are Copyright 2020 Dynmap Contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MarkerSet} from "dynmap";
import {
	LiveAtlasMarker,
	LiveAtlasMarkerSet,
	LiveAtlasPlayer,
	LiveAtlasWorldDefinition
} from "@/index";
import {DynmapUrlConfig} from "@/dynmap";
import {MutationTypes} from "@/store/mutation-types";
import {ActionTypes} from "@/store/action-types";
import ChatError from "@/errors/ChatError";
import MapProvider from "@/providers/MapProvider";
import {
	buildAreas,
	buildCircles, buildComponents,
	buildLines,
	buildMarkers,
	buildMarkerSet,
	buildMessagesConfig,
	buildServerConfig, buildUpdates, buildWorlds
} from "@/util/dynmap";
import ConfigurationError from "@/errors/ConfigurationError";
import {DynmapTileLayer} from "@/leaflet/tileLayer/DynmapTileLayer";
import {LiveAtlasTileLayer, LiveAtlasTileLayerOptions} from "@/leaflet/tileLayer/LiveAtlasTileLayer";
import {validateConfigURL} from "@/util";

export default class DynmapMapProvider extends MapProvider {
	private configurationAbort?: AbortController = undefined;
	private	markersAbort?: AbortController = undefined;
	private	updateAbort?: AbortController = undefined;

	private updatesEnabled = false;
	private updateTimeout: null | ReturnType<typeof setTimeout> = null;
	private updateTimestamp: Date = new Date();
	private updateInterval: number = 3000;

	private markerSets: Map<string, LiveAtlasMarkerSet> = new Map();
	private markers = new Map<string, Map<string, LiveAtlasMarker>>();
	private socket: WebSocket | null = null;

	constructor(name: string, config: DynmapUrlConfig) {
		super(name, config);
		this.validateConfig();
	}

	private validateConfig() {
		if(typeof this.config !== 'undefined') {
			if (!this.config || this.config.constructor !== Object) {
				throw new ConfigurationError(`Dynmap configuration object missing`);
			}

			validateConfigURL(this.config.configuration, this.name, 'configuration');
			validateConfigURL(this.config.update, this.name,'update');
			validateConfigURL(this.config.markers, this.name,'markers');
			validateConfigURL(this.config.tiles, this.name,'tiles');
			validateConfigURL(this.config.sendmessage, this.name,'sendmessage');
		}
	}

	private async getMarkerSets(world: LiveAtlasWorldDefinition): Promise<void> {
		const url = `${this.config.markers}_markers_/marker_${encodeURIComponent(world.name)}.json`;

		if(this.markersAbort) {
			this.markersAbort.abort();
		}

		this.markersAbort = new AbortController();

		const response = await this.getJSON(url, this.markersAbort.signal);

		response.sets = response.sets || {};

		for (const key in response.sets) {
			if (!Object.prototype.hasOwnProperty.call(response.sets, key)) {
				continue;
			}

			const set: MarkerSet = response.sets[key],
				markerSet = buildMarkerSet(key, set),
				markers = new Map<string, LiveAtlasMarker>();

			buildMarkers(set.markers || {}, markers, this.config);
			buildAreas(set.areas || {}, markers);
			buildLines(set.lines || {}, markers);
			buildCircles(set.circles || {}, markers);

			this.markerSets.set(key, markerSet);
			this.markers.set(key, markers);
		}
	}

	async loadServerConfiguration(): Promise<void> {
		if(this.configurationAbort) {
			this.configurationAbort.abort();
		}

		this.configurationAbort = new AbortController();

		const response = await this.getJSON(this.config.configuration, this.configurationAbort.signal);

		if (response.error) {
			throw new Error(response.error);
		}

		const config = buildServerConfig(response);

		this.updateInterval = response.updaterate || 3000;

		this.store.commit(MutationTypes.SET_SERVER_CONFIGURATION, config);
		this.store.commit(MutationTypes.SET_SERVER_CONFIGURATION_HASH, response.confighash || 0);
		this.store.commit(MutationTypes.SET_MAX_PLAYERS, response.maxcount || 0);
		this.store.commit(MutationTypes.SET_MESSAGES, buildMessagesConfig(response));
		this.store.commit(MutationTypes.SET_WORLDS, buildWorlds(response, this.config));
		this.store.commit(MutationTypes.SET_COMPONENTS, buildComponents(response, this.config));
		this.store.commit(MutationTypes.SET_LOGGED_IN, response.loggedin || false);
	}

	async populateWorld(world: LiveAtlasWorldDefinition): Promise<void> {
		await this.getMarkerSets(world);

		this.store.commit(MutationTypes.SET_MARKER_SETS, this.markerSets);
		this.store.commit(MutationTypes.SET_MARKERS, this.markers);

		this.markerSets.clear();
		this.markers.clear();
	}

	createTileLayer(options: LiveAtlasTileLayerOptions): LiveAtlasTileLayer {
		return new DynmapTileLayer(options);
	}

	private async processUpdate(response: any): Promise<void> {
		const players: Set<LiveAtlasPlayer> = new Set(),
			updates = buildUpdates(response.updates || [], this.updateTimestamp, this.config),
			worldState = {
				timeOfDay: response.servertime || 0,
				thundering: response.isThundering || false,
				raining: response.hasStorm || false,
			};

		(response.players || []).forEach((player: any) => {
			const world = player.world && player.world !== '-some-other-bogus-world-' ? player.world : undefined;

			players.add({
				name: player.account || "",
				displayName: player.name || "",
				health: player.health || 0,
				armor: player.armor || 0,
				sort: player.sort || 0,
				hidden: !world,
				location: {
					//Add 0.5 to position in the middle of a block
					x: !isNaN(player.x) ? player.x + 0.5 : 0,
					y: !isNaN(player.y) ? player.y : 0,
					z: !isNaN(player.z) ? player.z + 0.5 : 0,
					world: world,
				}
			});
		});

		this.updateTimestamp = new Date(response.timestamp || 0);

		this.store.commit(MutationTypes.SET_WORLD_STATE, worldState);
		this.store.commit(MutationTypes.ADD_MARKER_SET_UPDATES, updates.markerSets);
		this.store.commit(MutationTypes.ADD_MARKER_UPDATES, updates.markers);
		this.store.commit(MutationTypes.ADD_TILE_UPDATES, updates.tiles);
		this.store.commit(MutationTypes.ADD_CHAT, updates.chat);

		if(response.confighash) {
			this.store.commit(MutationTypes.SET_SERVER_CONFIGURATION_HASH, response.confighash);
		}

		await this.store.dispatch(ActionTypes.SET_PLAYERS, players);
	}

	sendChatMessage(message: string) {
		if (!this.store.state.components.chatSending) {
			return Promise.reject(this.store.state.messages.chatErrorDisabled);
		}

		return fetch(this.config.sendmessage, {
			method: 'POST',
			credentials: 'include',
			body: JSON.stringify({
				name: null,
				message: message,
			})
		}).then((response) => {
			if (response.status === 403) { //Rate limited
				throw new ChatError(this.store.state.messages.chatErrorCooldown
					.replace('%interval%', this.store.state.components.chatSending!.cooldown.toString()));
			}

			if (!response.ok) {
				throw new Error('Network request failed');
			}

			return response.json();
		}).then(response => {
			if (response.error !== 'none') {
				throw new ChatError(this.store.state.messages.chatErrorNotAllowed);
			}
		}).catch(e => {
			if (!(e instanceof ChatError)) {
				console.error(this.store.state.messages.chatErrorUnknown);
				console.trace(e);
			}

			throw e;
		});
	}

	startUpdates() {
		this.updatesEnabled = true;
		this.connectSocket();
	}

	private connectSocket() {
		if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
			this.sendSubscription();
			return;
		}

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const host = window.location.host || 'localhost:8082';
		const wsUrl = `${protocol}//${host}/ws`;

		console.log(`[WS] Connecting to ${wsUrl}`);
		this.socket = new WebSocket(wsUrl);

		this.socket.onopen = () => {
			console.log('[WS] Connected');
			this.sendSubscription();
		};

		this.socket.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				if (message.type === 'update') {
					this.processUpdate(message.data);
				}
			} catch (e) {
				console.error('[WS] Failed to parse message', e);
			}
		};

		this.socket.onclose = (event) => {
			console.log('[WS] Disconnected, code:', event.code);
			if (this.updatesEnabled) {
				setTimeout(() => this.connectSocket(), 3000);
			}
		};

		this.socket.onerror = (error) => {
			console.error('[WS] Error:', error);
		};
	}

	private sendSubscription() {
		if (this.socket && this.socket.readyState === WebSocket.OPEN && this.store.state.currentWorld) {
			const sub = {
				type: 'subscribe',
				world: this.store.state.currentWorld.name
			};
			this.socket.send(JSON.stringify(sub));
		}
	}

	stopUpdates() {
		this.updatesEnabled = false;

		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}

		if (this.updateTimeout) {
			clearTimeout(this.updateTimeout);
		}
		this.updateTimeout = null;

		if(this.configurationAbort) {
			this.configurationAbort.abort();
		}
		if(this.updateAbort) {
			this.updateAbort.abort();
		}
		if(this.markersAbort) {
			this.markersAbort.abort();
		}
	}

    async login(data: any) {
		if (!this.store.getters.loginEnabled) {
			return Promise.reject(this.store.state.messages.loginErrorDisabled);
		}

		this.store.commit(MutationTypes.SET_LOGGED_IN, false);

		try {
			const body = new URLSearchParams();

			body.append('j_username', data.username || '');
			body.append('j_password', data.password || '');


			const response = await DynmapMapProvider.fetchJSON(this.config.login, {
				method: 'POST',
				body,
			});

			switch(response.result) {
				case 'success':
					this.store.commit(MutationTypes.SET_LOGGED_IN, true);
					return;

				case 'loginfailed':
					return Promise.reject(this.store.state.messages.loginErrorIncorrect);

				default:
					return Promise.reject(this.store.state.messages.loginErrorUnknown);
			}
		} catch(e) {
			console.error(this.store.state.messages.loginErrorUnknown);
			console.trace(e);
			return Promise.reject(this.store.state.messages.loginErrorUnknown);
		}
	}

	async logout() {
		if (!this.store.getters.loginEnabled) {
			return Promise.reject(this.store.state.messages.loginErrorDisabled);
		}

		try {
			await DynmapMapProvider.fetchJSON(this.config.login, {
				method: 'POST',
			});

			this.store.commit(MutationTypes.SET_LOGGED_IN, false);
		} catch(e) {
			return Promise.reject(this.store.state.messages.logoutErrorUnknown);
		}
	}

    async register(data: any) {
		if (!this.store.getters.loginEnabled) {
			return Promise.reject(this.store.state.messages.loginErrorDisabled);
		}

		this.store.commit(MutationTypes.SET_LOGGED_IN, false);

		try {
			const body = new URLSearchParams();

			body.append('j_username', data.username || '');
			body.append('j_password', data.password || '');
			body.append('j_verify_password', data.password || '');
			body.append('j_passcode', data.code || '');

			const response = await DynmapMapProvider.fetchJSON(this.config.register, {
				method: 'POST',
				body,
			});

			switch(response.result) {
				case 'success':
					this.store.commit(MutationTypes.SET_LOGGED_IN, true);
					return;

				case 'verifyfailed':
					return Promise.reject(this.store.state.messages.registerErrorVerifyFailed);

				case 'registerfailed':
					return Promise.reject(this.store.state.messages.registerErrorIncorrect);

				default:
					return Promise.reject(this.store.state.messages.registerErrorUnknown);
			}
		} catch(e) {
			console.error(this.store.state.messages.registerErrorUnknown);
			console.trace(e);
			return Promise.reject(this.store.state.messages.registerErrorUnknown);
		}
	}

	protected async getJSON(url: string, signal: AbortSignal) {
		return MapProvider.fetchJSON(url, {signal, credentials: 'include'}).then(response => {
			if(response.error === 'login-required') {
				this.store.commit(MutationTypes.SET_LOGIN_REQUIRED, true);
				throw new Error("Login required");
			}

			return response;
		});
	}
}
