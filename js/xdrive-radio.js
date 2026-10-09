/**
 * ============================================================
 * X DRIVE RADIO — xdrive-radio.js
 * Official Audiomack Playlist Integration & Voice Architecture
 * 
 * Flow:
 *   1. Web page loads up then automactically activates X Drive's radio.
 *   2. X Drive plays the welcome voice ("Welcome to X Drive...").
 *   3. While welcome voice is playing, initialize/load Audiomack iframe.
 *   4. When welcome voice finishes, attempt to start Audiomack playlist.
 *   5. If official embed does not permit programmatic playback,
 *      do NOT fake the playing state.
 *   6. Instead, keep Audiomack player visible and provide clear
 *      PLAY control so user can start the playlist with one click.
 * ============================================================
 */

(function (window, document) {
    'use strict';

    /* --- Configuration --- */
    const CONFIG = {
        playlistName: "X Drive's Playlist 1",
        welcomeAudio: 'assets/audio/xdrive-welcome.mp3',
        fallbackAudio: "assets/audio/X-Drive's welcome audio.mp3",
        playlistTracks: [
            '32Stitches-Uncharted [NCS Release].mp3',
            'Aleesia-JPB-High[NCS Release].mp3',
            'Anna-Yvette-Lost-Sky-Carry-On[NCS Release].mp3',
            'Crushed-Candy-Oh My-Gawd[NCS Release].mp3',
            'Dax-VinDon-Unknown-Brain-Phenomenon[NCS Release].mp3',
            'DIECXLD-Prod.94-flowers-in-my-head[NCS Release].mp3',
            'gabriawll-QKReign-Missing-Life[NCS Release].mp3',
            'Goodknight-Freedom[NCS Release].mp3',
            'Henri-Werner-Burned[NCS Release].mp3',
            'if-found-Met-You[NCS Release].mp3',
            'Jimmy-Rivler-Max-Vermeulen-Almost-Weekend-Let-Me-Go[NCS Release].mp3',
            'joegarratt-aya[NCS Release].mp3',
            'JSTN-DMND-ALVYN-SKY-BRI[NCS Release].mp3',
            "Kyle-Reynolds-Unknown-Brain-I'm-Sorry-Mom[NCS Release].mp3",
            'Lennart-Schroot-Josh-Levoid-Wiguez-Get-Out-Here(Lennart Schroot Remix)[NCS Release] (1).mp3',
            'Nat-James-22-Void-Beats-VERB-Ignite[NCS Release].mp3',
            'Part-Native-Oly-Artificial-Love[NCS Release].mp3',
            "PHI-NIX-Can't-Break-Me-Down[NCS Release].mp3",
            'rghvarchive-RedWater-Say-To-You[NCS Release].mp3',
            'RYVN-Avatar[NCS Release].mp3',
            'Sara-Skinner-Lost-Sky-Johnning-Janji-Heroes-TonightxDreams-pt-IIMashup [NCS Release].mp3',
            'Tinoma-Find-You[NCS Release].mp3',
            'Tom-Wilson-Jagsy-braev-All-My-Love[NCS Release].mp3',
            'Unknown-Brain-Oh-Darling[NCS Release].mp3',
            'Unknown-Brain-Glaceo-Jungle-Of-Love[NCS Release].mp3',
            'Unknown-Brain-NotEvenTanner-Let-You-Go[NCS Release].mp3',
            'wayudance-Time[NCS Release].mp3'
        ]
    };

    /* --- Radio States (Strictly matching specifications) --- */
    const STATE = {
        IDLE: 'IDLE',
        WELCOME_PLAYING: 'WELCOME_PLAYING',
        MUSIC_LOADING: 'MUSIC_LOADING',
        PLAYING: 'PLAYING',
        PAUSED: 'PAUSED',
        BLOCKED: 'BLOCKED',
        ERROR: 'ERROR'
    };

    /* --- Playlist Player State --- */
    const PLAYLIST_STATE = {
        NOT_INITIALIZED: 'INITIALIZED',
        LOADING: 'LOADING',
        READY: 'READY',
        PLAYING: 'PLAYING',
        PAUSED: 'PAUSED'
    };

    /* --- Status Labels Displayed in UI --- */
    const STATUS_LABELS = {
        [STATE.IDLE]: 'READY',
        [STATE.WELCOME_PLAYING]: 'WELCOME',
        [STATE.MUSIC_LOADING]: 'CONNECTING',
        [STATE.PLAYING]: 'PLAYING',
        [STATE.PAUSED]: 'PAUSED',
        [STATE.BLOCKED]: 'TAP TO PLAY',
        [STATE.ERROR]: 'ERROR'
    };

    /* --- Session Storage Keys --- */
    const STORAGE_KEYS = {
        WELCOME_PLAYED: 'xdrive_radio_welcome_played',
        ENABLED: 'xdrive_radio_enabled',
        USER_PAUSED: 'xdrive_radio_user_paused',
        PROGRESS: 'xdrive_radio_progress_v1'
    };

    const SS = {
        get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
        set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { } },
        del: (k) => { try { sessionStorage.removeItem(k); } catch (e) { } }
    };

    function readPlaybackProgress() {
        try {
            const saved = JSON.parse(SS.get(STORAGE_KEYS.PROGRESS) || 'null');
            if (!saved || saved.version !== 1 || !['welcome', 'playlist'].includes(saved.phase)) return null;
            if (!Number.isInteger(saved.trackIndex) || saved.trackIndex < 0 || saved.trackIndex >= CONFIG.playlistTracks.length) return null;
            return {
                phase: saved.phase,
                trackIndex: saved.trackIndex,
                currentTime: Number.isFinite(saved.currentTime) && saved.currentTime >= 0 ? saved.currentTime : 0,
                muted: Boolean(saved.muted),
                userPaused: Boolean(saved.userPaused)
            };
        } catch (e) {
            return null;
        }
    }

    function persistPlaybackProgress(force) {
        if (!_playbackPhase) return;
        const audio = _playbackPhase === 'welcome' ? _welcomeAudio : _playlistAudio;
        const measuredTime = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const currentTime = _resumePosition > measuredTime && measuredTime === 0 ? _resumePosition : measuredTime;
        const progress = {
            version: 1,
            phase: _playbackPhase,
            trackIndex: _currentTrackIndex,
            currentTime: Math.max(0, currentTime || 0),
            muted: _isMuted,
            userPaused: _userPaused
        };
        SS.set(STORAGE_KEYS.PROGRESS, JSON.stringify(progress));
        if (_userPaused) SS.set(STORAGE_KEYS.USER_PAUSED, 'true');
        else SS.del(STORAGE_KEYS.USER_PAUSED);
    }

    function restoreAudioPosition(audio, position) {
        if (!audio || !Number.isFinite(position) || position < 0) return;
        const seek = () => {
            try {
                if (!Number.isFinite(audio.duration) || position < audio.duration) audio.currentTime = position;
            } catch (e) { /* Metadata may not be ready yet; the listener below will retry. */ }
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener('loadedmetadata', seek, { once: true });
    }

    function attachProgressTracking(audio, phase) {
        if (audio._xDriveProgressTracked) return;
        audio._xDriveProgressTracked = true;
        audio.addEventListener('timeupdate', () => {
            if (_playbackPhase === phase && (phase !== 'playlist' || audio === _playlistAudio)) {
                persistPlaybackProgress(false);
                if (audio.currentTime > 0) _resumePosition = 0;
            }
        });
        audio.addEventListener('play', () => {
            if (_playbackPhase === phase && (phase !== 'playlist' || audio === _playlistAudio)) {
                _userPaused = false;
                persistPlaybackProgress(true);
            }
        });
        audio.addEventListener('pause', () => {
            if (_playbackPhase === phase && (phase !== 'playlist' || audio === _playlistAudio)) persistPlaybackProgress(true);
        });
    }

    /* --- Internal Variables --- */
    let _radioState = STATE.IDLE;
    let _playlistPlayerState = PLAYLIST_STATE.NOT_INITIALIZED;
    let _welcomeVoiceCompleted = false;
    let _userPaused = false;
    let _drawerOpen = false;
    let _isMinimized = false;
    let _isMuted = false;
    let _currentTrackIndex = 0;
    let _playbackPhase = null;
    let _resumePosition = 0;
    let _crossfadeDuration = 2000;

    /* --- Audio Systems --- */
    let _welcomeAudio = null;
    let _playlistAudio = null;
    let _transitionAudio = null;
    let _playlistDecks = [];
    let _isTransitioning = false;

    /* --- DOM References --- */
    let _wrapperEl = null;
    let _playBtnEl = null;
    let _muteBtnEl = null;
    let _drawerBtnEl = null;
    let _minBtnEl = null;
    let _statusTextEl = null;
    let _msgEl = null;

    /* --- State Transition Function --- */
    function setRadioState(newState, customLabel) {
        _radioState = newState;
        const label = customLabel || STATUS_LABELS[newState] || 'READY';

        if (_statusTextEl) {
            _statusTextEl.textContent = label;
        }

        if (!_wrapperEl) return;

        // Manage state classes
        _wrapperEl.classList.remove('is-welcome', 'is-playing', 'is-tap-to-play');

        if (newState === STATE.WELCOME_PLAYING) {
            _wrapperEl.classList.add('is-welcome');
            if (_msgEl) _msgEl.textContent = "Welcome to X Drive";
            updatePlayBtnIcons(true);
        } else if (newState === STATE.PLAYING) {
            _wrapperEl.classList.add('is-playing');
            if (_msgEl) _msgEl.textContent = CONFIG.playlistName;
            updatePlayBtnIcons(true);
        } else if (newState === STATE.BLOCKED || customLabel === 'TAP TO PLAY') {
            _wrapperEl.classList.add('is-tap-to-play');
            if (_msgEl) _msgEl.textContent = "Tap to Play X Drive's Playlist";
            updatePlayBtnIcons(false);
        } else if (newState === STATE.PAUSED) {
            if (_msgEl) _msgEl.textContent = "X Drive Radio Paused";
            updatePlayBtnIcons(false);
        } else if (newState === STATE.MUSIC_LOADING) {
            if (_msgEl) _msgEl.textContent = "Connecting to X-Drive...";
        }
    }

    /* --- DOM Builder --- */
    function buildDOM() {
        if (document.getElementById('xdrive-radio-wrapper')) return;

        const wrapper = document.createElement('aside');
        wrapper.id = 'xdrive-radio-wrapper';
        wrapper.className = 'xdrive-radio-wrapper';
        wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', 'X Drive Radio');

        wrapper.innerHTML = `
            <div class="xdrive-radio-bar" id="xdrive-radio-bar">
                <!-- Sound Equalizer -->
                <div class="xdrive-radio__eq" aria-hidden="true" title="Sound Equalizer">
                    <span class="xdrive-radio__eq-bar"></span>
                    <span class="xdrive-radio__eq-bar"></span>
                    <span class="xdrive-radio__eq-bar"></span>
                    <span class="xdrive-radio__eq-bar"></span>
                </div>

                <!-- Branding & Info -->
                <div class="xdrive-radio__brand">
                    <span class="xdrive-radio__brand-text">X DRIVE RADIO</span>
                    <div class="xdrive-radio__msg" id="xdrive-radio-msg" title="Now Playing">
                        ${CONFIG.playlistName}
                    </div>
                </div>

                <!-- Status Badge -->
                <div class="xdrive-radio__badge" id="xdrive-radio-badge" title="Radio Status">
                    <span class="xdrive-radio__badge-dot"></span>
                    <span id="xdrive-radio-status-text">READY</span>
                </div>

                <!-- Controls -->
                <div class="xdrive-radio__controls">
                    <!-- Previous Track -->
                    <button class="xdrive-radio__btn" id="xdr-prev-btn" type="button" aria-label="Previous Track" title="Previous Track">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" fill="currentColor"/></svg>
                    </button>

                    <!-- Play / Pause Button -->
                    <button class="xdrive-radio__btn xdrive-radio__btn--primary" id="xdrive-radio-play-btn" type="button" aria-label="Play / Pause" title="Play / Pause">
                        <svg id="xdrive-radio-icon-pause" viewBox="0 0 16 16"><path d="M4 3h3v10H4zm5 0h3v10H9z"/></svg>
                        <svg id="xdrive-radio-icon-play" viewBox="0 0 16 16" style="display:none;"><path d="M4 3l9 5-9 5z"/></svg>
                    </button>

                    <!-- Next Track -->
                    <button class="xdrive-radio__btn" id="xdr-next-btn" type="button" aria-label="Next Track" title="Next Track">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M16 18h2V6h-2zm-11-7l8.5-6v12z" fill="currentColor"/></svg>
                    </button>

                    <!-- Mute / Unmute Button -->
                    <button class="xdrive-radio__btn" id="xdrive-radio-mute-btn" type="button" aria-label="Mute / Unmute" title="Mute / Unmute">
                        <svg id="xdrive-radio-icon-vol" viewBox="0 0 16 16"><path d="M9 2.5L5 6H2v4h3l4 3.5v-11zm2.5 2.5a4.5 4.5 0 0 1 0 6v-1.5a3 3 0 0 0 0-3V5z"/></svg>
                        <svg id="xdrive-radio-icon-muted" viewBox="0 0 16 16" style="display:none;"><path d="M9 2.5L5 6H2v4h3l4 3.5v-11zm3.8 3.7l-1.1-1.1-1.4 1.4-1.4-1.4-1.1 1.1 1.4 1.4-1.4 1.4 1.1 1.1 1.4-1.4 1.4 1.4 1.1-1.1-1.4-1.4 1.4-1.4z"/></svg>
                    </button>
                </div>
            </div>

            <!-- Expandable Player Drawer -->
            <div class="xdrive-radio__drawer" id="xdrive-radio-drawer">
                <div class="xdrive-radio__drawer-header">
                    <div class="xdrive-radio__drawer-title">
                        <span>X Drive's Playlist 1</span>
                    </div>
                    <div class="xdrive-radio__drawer-actions">
                        <span class="xdrive-radio__drawer-track-count">${CONFIG.playlistTracks.length} NCS Tracks</span>
                        <button class="xdrive-radio__drawer-close" id="xdrive-radio-drawer-close" type="button" title="Close Player" aria-label="Close Player">✕</button>
                    </div>
                </div>
                <div class="xdrive-radio__drawer-body">
                    <div class="xdrive-radio__iframe-holder" id="xdrive-radio-iframe-container">
                        <!-- Official Audiomack iframe inserted dynamically -->
                    </div>
                </div>
            </div>
        `;

        document.body.prepend(wrapper);

        _wrapperEl = wrapper;
        _playBtnEl = document.getElementById('xdrive-radio-play-btn');
        _muteBtnEl = document.getElementById('xdrive-radio-mute-btn');
        _drawerBtnEl = document.getElementById('xdrive-radio-drawer-btn');
        _minBtnEl = document.getElementById('xdrive-radio-min-btn');
        _statusTextEl = document.getElementById('xdrive-radio-status-text');
        _msgEl = document.getElementById('xdrive-radio-msg');

        _playBtnEl.addEventListener('click', handlePlayBtnClick);
        _muteBtnEl.addEventListener('click', handleMuteBtnClick);

        // Wire up playlist controls
        const prevBtn = document.getElementById('xdr-prev-btn');
        const nextBtn = document.getElementById('xdr-next-btn');
        if (prevBtn) prevBtn.addEventListener('click', playPrevious);
        if (nextBtn) nextBtn.addEventListener('click', playNext);

        // Clicking the bar directly when blocked/tap-to-play triggers playback
        document.getElementById('xdrive-radio-bar').addEventListener('click', function (e) {
            if (_isMinimized) {
                toggleMinimize(e);
                return;
            }
            if (_radioState === STATE.BLOCKED || _radioState === STATE.IDLE || !_welcomeVoiceCompleted) {
                if (!e.target.closest('button')) {
                    handlePlayBtnClick(e);
                }
            }
        });

    }

    /* --- System B: Playlist Audio Player --- */
    function initializePlaylistPlayer() {
        if (_playlistPlayerState !== PLAYLIST_STATE.NOT_INITIALIZED) {
            return;
        }

        _playlistPlayerState = PLAYLIST_STATE.LOADING;
        console.log('[XDriveRadio] Initializing Playlist 1 (' + CONFIG.playlistTracks.length + ' tracks)');

        _playlistAudio = new Audio();
        _playlistAudio.preload = 'auto';
        _playlistAudio.volume = 0;
        attachProgressTracking(_playlistAudio, 'playlist');
        _playlistDecks = [_playlistAudio];

        _playlistAudio.addEventListener('ended', handleTrackEnded);
        _playlistAudio.addEventListener('canplay', function() {
            if (_playlistPlayerState === PLAYLIST_STATE.LOADING) {
                _playlistPlayerState = PLAYLIST_STATE.READY;
                console.log('[XDriveRadio] Playlist player ready');
            }
        });

        _playlistAudio.addEventListener('error', function(e) {
            console.error('[XDriveRadio] Playlist audio error:', e);
        });

        loadTrack(_currentTrackIndex);
        if (_playbackPhase === 'playlist') restoreAudioPosition(_playlistAudio, _resumePosition);
        preloadNextTracks(3);
        updateDrawerUI();
    }

    function preloadNextTracks(count) {
        if (!_playlistAudio || !CONFIG.playlistTracks.length) return;

        const nextIndex = (_currentTrackIndex + 1) % CONFIG.playlistTracks.length;
        let preloadAudio = _playlistDecks.find(deck => deck !== _playlistAudio);
        if (!preloadAudio) {
            preloadAudio = new Audio();
            preloadAudio.preload = 'auto';
            attachProgressTracking(preloadAudio, 'playlist');
            _playlistDecks.push(preloadAudio);
        }

        if (preloadAudio._xDriveTrackIndex !== nextIndex) {
            preloadAudio.pause();
            preloadAudio.removeEventListener('ended', handleTrackEnded);
            preloadAudio.volume = 0;
            preloadAudio.muted = _isMuted;
            preloadAudio.src = 'assets/audio/Playlist-1/' + CONFIG.playlistTracks[nextIndex];
            preloadAudio._xDriveTrackIndex = nextIndex;
            preloadAudio.load();
        }
        console.log('[XDriveRadio] Preloading next track: ' + getTrackName(CONFIG.playlistTracks[nextIndex]));
    }

    function loadTrack(index) {
        if (index < 0 || index >= CONFIG.playlistTracks.length) return;
        
        _currentTrackIndex = index;
        const folderPath = 'assets/audio/Playlist-1/';
        const trackPath = folderPath + CONFIG.playlistTracks[index];
        
        if (_playlistAudio) {
            _playlistAudio.src = trackPath;
            _playlistAudio.load();
            console.log('[XDriveRadio] Loaded track ' + (index + 1) + '/' + CONFIG.playlistTracks.length + ': ' + getTrackName(CONFIG.playlistTracks[index]));
            updateDrawerUI();
        }
    }

    function getTrackName(filename) {
        return filename.replace(' [NCS Release].mp3', '').replace('.mp3', '');
    }

    function handleTrackEnded() {
        console.log('[XDriveRadio] Track ended');
        
        // Check if we've reached the end of the playlist
        if (_currentTrackIndex === CONFIG.playlistTracks.length - 1) {
            console.log('[XDriveRadio] Playlist exhausted, restarting cycle');
            restartCycle();
        } else {
            playNext();
        }
    }

    function playNext() {
        const nextIndex = (_currentTrackIndex + 1) % CONFIG.playlistTracks.length;
        transitionToTrack(nextIndex);
    }

    function playPrevious() {
        const prevIndex = (_currentTrackIndex - 1 + CONFIG.playlistTracks.length) % CONFIG.playlistTracks.length;
        transitionToTrack(prevIndex);
    }

    // Alternate between two persistent decks so outgoing fades cannot pause
    // the incoming track, and browsers do not need a new audio element per song.
    function transitionToTrack(index) {
        if (index < 0 || index >= CONFIG.playlistTracks.length || _isTransitioning) return;
        if (_radioState !== STATE.PLAYING || !_playlistAudio) {
            loadTrack(index);
            _resumePosition = 0;
            if (_playbackPhase === 'playlist') persistPlaybackProgress(true);
            return;
        }

        const outgoing = _playlistAudio;
        let incoming = _playlistDecks.find(deck => deck !== outgoing);
        if (!incoming) {
                incoming = new Audio();
                incoming.preload = 'auto';
                attachProgressTracking(incoming, 'playlist');
                _playlistDecks.push(incoming);
        }
        const trackPath = 'assets/audio/Playlist-1/' + CONFIG.playlistTracks[index];
        _transitionAudio = incoming;
        _isTransitioning = true;
        incoming.pause();
        incoming.removeEventListener('ended', handleTrackEnded);
        incoming.volume = 0;
        incoming.muted = _isMuted;
        incoming.addEventListener('ended', handleTrackEnded);
        const onLoadError = function () {
            console.error('[XDriveRadio] Could not load track:', trackPath);
            _transitionAudio = null;
            _isTransitioning = false;
            setRadioState(STATE.ERROR);
        };
        incoming.addEventListener('error', onLoadError, { once: true });
        if (incoming._xDriveTrackIndex !== index || incoming.error) {
            incoming.src = trackPath;
            incoming._xDriveTrackIndex = index;
            incoming.load();
        }

        const beginTransition = () => {
            incoming.removeEventListener('canplay', beginTransition);
            incoming.play().then(() => {
                incoming.removeEventListener('error', onLoadError);
                _playlistAudio = incoming;
                _currentTrackIndex = index;
                _resumePosition = 0;
                updateDrawerUI();
                persistPlaybackProgress(true);
                if (_msgEl) _msgEl.textContent = getTrackName(CONFIG.playlistTracks[index]);
                Promise.all([
                    crossfadeIn(incoming, _crossfadeDuration),
                    crossfadeOut(outgoing, _crossfadeDuration)
                ]).then(() => {
                    outgoing.removeEventListener('ended', handleTrackEnded);
                    _transitionAudio = null;
                    _isTransitioning = false;
                    _playlistPlayerState = PLAYLIST_STATE.PLAYING;
                    preloadNextTracks(2);
                });
            }).catch(error => {
                console.error('[XDriveRadio] Track transition failed:', error);
                incoming.removeEventListener('ended', handleTrackEnded);
                _transitionAudio = null;
                _isTransitioning = false;
                setRadioState(STATE.ERROR);
            });
        };

        if (incoming.readyState >= 3) beginTransition();
        else incoming.addEventListener('canplay', beginTransition, { once: true });
    }

    function updateDrawerUI() {
        // Update the main bar message with current track info
        const trackName = getTrackName(CONFIG.playlistTracks[_currentTrackIndex]);
        const trackNumber = _currentTrackIndex + 1;
        const totalTracks = CONFIG.playlistTracks.length;
        
        if (_msgEl) {
            _msgEl.textContent = `${trackNumber}/${totalTracks} • ${trackName}`;
        }
    }

    function updatePlayPauseIcon() {
        const playIcon = document.getElementById('xdr-play-icon');
        const pauseIcon = document.getElementById('xdr-pause-icon');
        const isPlaying = _radioState === STATE.PLAYING;
        
        if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'block';
        if (pauseIcon) pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }

    function togglePlaylistPlayback() {
        if (_radioState === STATE.PLAYING) {
            if (_playlistAudio) _playlistAudio.pause();
            setRadioState(STATE.PAUSED);
            updatePlayPauseIcon();
        } else {
            if (_playlistAudio) _playlistAudio.play();
            setRadioState(STATE.PLAYING);
            updatePlayPauseIcon();
        }
    }



    /* --- System A: Local Welcome Audio --- */
    function initWelcomeAudio() {
        if (_welcomeAudio) return;

        _welcomeAudio = new Audio();
        _welcomeAudio.preload = 'auto';
        _welcomeAudio.src = CONFIG.welcomeAudio;
        attachProgressTracking(_welcomeAudio, 'welcome');

        // Fallback for filename difference
        _welcomeAudio.addEventListener('error', function () {
            if (_welcomeAudio.src.indexOf(CONFIG.fallbackAudio) === -1) {
                _welcomeAudio.src = CONFIG.fallbackAudio;
                _welcomeAudio.load();
            }
        });

        // Welcome Audio Handler
        _welcomeAudio.addEventListener('ended', handleWelcomeEnded);
    }

    function startWelcomeAudio(resumeAt = _resumePosition) {
        initWelcomeAudio();
        initializePlaylistPlayer();

        _playbackPhase = 'welcome';
        _welcomeVoiceCompleted = false;
        _userPaused = false;
        setRadioState(STATE.WELCOME_PLAYING);
        console.log('[XDriveRadio] Welcome started, preloading playlist');

        restoreAudioPosition(_welcomeAudio, Number.isFinite(resumeAt) ? resumeAt : 0);
        _welcomeAudio.muted = _isMuted;
        persistPlaybackProgress(true);
        const playPromise = _welcomeAudio.play();

        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log('[XDriveRadio] Welcome voice playing');
            }).catch((error) => {
                console.error('[XDriveRadio] Welcome audio failed to start', error);
                setRadioState(STATE.BLOCKED, 'TAP TO PLAY');
            });
        }
    }

    /* --- Welcome Audio Ended Handler --- */
    async function handleWelcomeEnded() {
        console.log('[XDriveRadio] Welcome ending, starting crossfade');
        _welcomeVoiceCompleted = true;
        _playbackPhase = 'playlist';
        _resumePosition = 0;
        _userPaused = false;
        persistPlaybackProgress(true);

        setRadioState(STATE.MUSIC_LOADING);
        
        // Fade out welcome while fading in playlist
        crossfadeOut(_welcomeAudio, _crossfadeDuration);

        try {
            await startPlaylistWithCrossfade();
        } catch (error) {
            console.error('[XDriveRadio] Playlist playback failed', error);
            setRadioState(STATE.ERROR);
        }
    }

    /* --- Playlist Playback with Crossfade --- */
    function startPlaylistWithCrossfade() {
        return new Promise((resolve) => {
            if (!_playlistAudio) {
                resolve();
                return;
            }

            _isTransitioning = true;
            _playlistAudio.volume = 0;
            _playlistAudio.muted = _isMuted;

            const attemptPlay = () => {
                const playPromise = _playlistAudio.play();

                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        console.log('[XDriveRadio] Playlist started, crossfading in');
                        crossfadeIn(_playlistAudio, _crossfadeDuration).then(() => {
                            _isTransitioning = false;
                            setRadioState(STATE.PLAYING);
                            if (_msgEl) _msgEl.textContent = getTrackName(CONFIG.playlistTracks[_currentTrackIndex]);
                            persistPlaybackProgress(true);
                            console.log('[XDriveRadio] Music playback confirmed');
                            resolve();
                        });
                    }).catch((error) => {
                        console.error('[XDriveRadio] Autoplay blocked', error);
                        _isTransitioning = false;
                        setRadioState(STATE.BLOCKED, 'TAP TO PLAY');
                        resolve();
                    });
                } else {
                    resolve();
                }
            };

            if (_playlistAudio.readyState >= 3) {
                attemptPlay();
            } else {
                const onCanPlay = () => {
                    _playlistAudio.removeEventListener('canplay', onCanPlay);
                    attemptPlay();
                };
                _playlistAudio.addEventListener('canplay', onCanPlay);
                
                setTimeout(() => {
                    _playlistAudio.removeEventListener('canplay', onCanPlay);
                    console.log('[XDriveRadio] Attempting play after brief wait');
                    attemptPlay();
                }, 1000);
            }
        });
    }

    function crossfadeIn(audio, duration) {
        return new Promise((resolve) => {
            const steps = 50;
            const interval = duration / steps;
            const volumeStep = 1.0 / steps;
            let currentStep = 0;

            const fadeInterval = setInterval(() => {
                currentStep++;
                audio.volume = Math.min(volumeStep * currentStep, 1.0);

                if (currentStep >= steps) {
                    clearInterval(fadeInterval);
                    audio.volume = 1.0;
                    resolve();
                }
            }, interval);
        });
    }

    function crossfadeOut(audio, duration) {
        return new Promise((resolve) => {
            const steps = 50;
            const interval = duration / steps;
            const volumeStep = audio.volume / steps;
            let currentStep = 0;

            const fadeInterval = setInterval(() => {
                currentStep++;
                audio.volume = Math.max(audio.volume - volumeStep, 0);

                if (currentStep >= steps) {
                    clearInterval(fadeInterval);
                    audio.volume = 0;
                    audio.pause();
                    resolve();
                }
            }, interval);
        });
    }

    function restartCycle() {
        console.log('[XDriveRadio] Restarting welcome + playlist cycle');
        _welcomeVoiceCompleted = false;
        _currentTrackIndex = 0;
        _resumePosition = 0;
        _playbackPhase = 'welcome';
        _userPaused = false;
        SS.del(STORAGE_KEYS.USER_PAUSED);
        loadTrack(0);
        startWelcomeAudio(0);
    }

    function resumeSavedPlaylist() {
        if (!_playlistAudio) initializePlaylistPlayer();
        if (!_playlistAudio) return;

        _playbackPhase = 'playlist';
        _welcomeVoiceCompleted = true;
        _playlistAudio.volume = 1;
        _playlistAudio.muted = _isMuted;
        setRadioState(STATE.MUSIC_LOADING, 'RESUMING');

        let playPromise;
        try {
            playPromise = _playlistAudio.play();
        } catch (error) {
            setRadioState(STATE.BLOCKED, 'TAP TO PLAY');
            return;
        }
        Promise.resolve(playPromise).then(() => {
            _playlistPlayerState = PLAYLIST_STATE.PLAYING;
            _userPaused = false;
            setRadioState(STATE.PLAYING);
            updateDrawerUI();
            persistPlaybackProgress(true);
        }).catch((error) => {
            console.info('[XDriveRadio] Resume needs a user gesture:', error);
            setRadioState(STATE.BLOCKED, 'TAP TO PLAY');
        });
    }

    /* --- Play / Pause Control Logic --- */
    function handlePlayBtnClick(e) {
        if (e) e.stopPropagation();

        if (_radioState === STATE.PLAYING) {
            _userPaused = true;
            SS.set(STORAGE_KEYS.USER_PAUSED, 'true');
            if (_playlistAudio) _playlistAudio.pause();
            if (_transitionAudio) _transitionAudio.pause();
            setRadioState(STATE.PAUSED);
            _playlistPlayerState = PLAYLIST_STATE.PAUSED;
            updatePlayPauseIcon();
            persistPlaybackProgress(true);
            return;
        }

        if (_radioState === STATE.WELCOME_PLAYING) {
            _userPaused = true;
            SS.set(STORAGE_KEYS.USER_PAUSED, 'true');
            if (_welcomeAudio) _welcomeAudio.pause();
            setRadioState(STATE.PAUSED);
            persistPlaybackProgress(true);
            return;
        }

        _userPaused = false;
        SS.del(STORAGE_KEYS.USER_PAUSED);
        SS.set(STORAGE_KEYS.ENABLED, 'true');
        persistPlaybackProgress(true);

        if (!_welcomeVoiceCompleted) {
            const welcomePosition = _welcomeAudio && Number.isFinite(_welcomeAudio.currentTime) && _welcomeAudio.currentTime > 0
                ? _welcomeAudio.currentTime
                : _resumePosition;
            startWelcomeAudio(welcomePosition);
        } else {
            console.log('[XDriveRadio] Attempting music playback');
            if (!_playlistAudio) initializePlaylistPlayer();
            if (!_playlistAudio) return;

            // A user gesture is the most reliable place to retry after an
            // autoplay handoff was blocked. Restore audible volume first:
            // initialization and the crossfade path both start at volume 0.
            _playlistAudio.volume = 1;
            _playlistAudio.muted = _isMuted;

            let playPromise;
            try {
                playPromise = _playlistAudio.play();
            } catch (error) {
                console.error('[XDriveRadio] Playlist playback failed', error);
                setRadioState(STATE.BLOCKED, 'TAP TO PLAY');
                return;
            }

            Promise.resolve(playPromise).then(() => {
                _playlistPlayerState = PLAYLIST_STATE.PLAYING;
                _playbackPhase = 'playlist';
                setRadioState(STATE.PLAYING);
                if (_msgEl) _msgEl.textContent = getTrackName(CONFIG.playlistTracks[_currentTrackIndex]);
                updatePlayPauseIcon();
                persistPlaybackProgress(true);
            }).catch((error) => {
                console.error('[XDriveRadio] Playlist playback failed', error);
                _playlistPlayerState = PLAYLIST_STATE.PAUSED;
                setRadioState(STATE.BLOCKED, 'TAP TO PLAY');
            });
        }
    }

    /* --- Mute / Unmute --- */
    function handleMuteBtnClick(e) {
        if (e) e.stopPropagation();
        _isMuted = !_isMuted;

        if (_welcomeAudio) {
            _welcomeAudio.muted = _isMuted;
        }

        if (_playlistAudio) {
            _playlistAudio.muted = _isMuted;
        }
        if (_transitionAudio) {
            _transitionAudio.muted = _isMuted;
        }

        syncMuteButtonIcon();
        persistPlaybackProgress(true);
    }

    function syncMuteButtonIcon() {
        const volIcon = document.getElementById('xdrive-radio-icon-vol');
        const muteIcon = document.getElementById('xdrive-radio-icon-muted');
        if (volIcon && muteIcon) {
            volIcon.style.display = _isMuted ? 'none' : 'block';
            muteIcon.style.display = _isMuted ? 'block' : 'none';
        }
    }

    /* --- Drawer & Minimize Controls --- */
    function setDrawerOpen(open) {
        _drawerOpen = open;
        if (_wrapperEl) {
            _wrapperEl.classList.toggle('is-drawer-open', _drawerOpen);
        }
    }

    function toggleDrawer(e) {
        if (e) e.stopPropagation();
        setDrawerOpen(!_drawerOpen);
    }

    function toggleMinimize(e) {
        if (e) e.stopPropagation();
        _isMinimized = !_isMinimized;
        if (_wrapperEl) {
            _wrapperEl.classList.toggle('is-minimized', _isMinimized);
            if (_isMinimized) {
                setDrawerOpen(false);
            }
        }
    }

    function updatePlayBtnIcons(isPlaying) {
        const pauseIcon = document.getElementById('xdrive-radio-icon-pause');
        const playIcon = document.getElementById('xdrive-radio-icon-play');
        if (pauseIcon && playIcon) {
            pauseIcon.style.display = isPlaying ? 'block' : 'none';
            playIcon.style.display = isPlaying ? 'none' : 'block';
        }
    }

    /* --- Auto-initialization on Page Load --- */
    function attemptAutoplay() {
        console.log('[XDriveRadio] Attempting autoplay on page load');
        setRadioState(STATE.MUSIC_LOADING, 'INITIALIZING');
        
        startWelcomeAudio();
    }

    /* --- Initialization --- */
    function init() {
        buildDOM();

        window.addEventListener('pagehide', () => persistPlaybackProgress(true));
        window.addEventListener('beforeunload', () => persistPlaybackProgress(true));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') persistPlaybackProgress(true);
        });

        const saved = readPlaybackProgress();
        if (saved) {
            _playbackPhase = saved.phase;
            _currentTrackIndex = saved.trackIndex;
            _resumePosition = saved.currentTime;
            _isMuted = saved.muted;
            syncMuteButtonIcon();
            _userPaused = saved.userPaused || SS.get(STORAGE_KEYS.USER_PAUSED) === 'true';
            _welcomeVoiceCompleted = saved.phase === 'playlist';

            if (saved.phase === 'playlist') {
                initializePlaylistPlayer();
                if (_userPaused) {
                    _playlistPlayerState = PLAYLIST_STATE.PAUSED;
                    setRadioState(STATE.PAUSED);
                    updatePlayBtnIcons(false);
                } else {
                    setTimeout(resumeSavedPlaylist, 100);
                }
            } else {
                initWelcomeAudio();
                restoreAudioPosition(_welcomeAudio, _resumePosition);
                if (_userPaused) {
                    setRadioState(STATE.PAUSED);
                    updatePlayBtnIcons(false);
                } else {
                    setTimeout(() => startWelcomeAudio(saved.currentTime), 100);
                }
            }
            return;
        }

        if (SS.get(STORAGE_KEYS.USER_PAUSED) === 'true') {
            _userPaused = true;
            initializePlaylistPlayer();
            setRadioState(STATE.PAUSED);
            return;
        }

        // Auto-start on page load
        setTimeout(attemptAutoplay, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window, document);
