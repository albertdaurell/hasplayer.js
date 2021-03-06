'use strict';
// don't disable metrics...
var angular = angular;

// add  MediaPlayer instance's global reference. Usefull to execute MediaPlayer API outside the scope of the app
var mediaPlayer = null;

angular.module('DashSourcesService', ['ngResource']).
factory('Sources', ['$resource', function($resource){
    return $resource('json/sources.json', {}, {
        query: {method:'GET', isArray:false}
    });
}]);

angular.module('DashNotesService', ['ngResource']).
factory('Notes', ['$resource', function($resource){
    return $resource('json/notes.json', {}, {
        query: {method:'GET', isArray:false}
    });
}]);

angular.module('DashContributorsService', ['ngResource']).
factory('Contributors', ['$resource', function($resource){
    return $resource('json/contributors.json', {}, {
        query: {method:'GET', isArray:false}
    });
}]);

angular.module('DashPlayerLibrariesService', ['ngResource']).
factory('PlayerLibraries', ['$resource', function($resource){
    return $resource('json/player_libraries.json', {}, {
        query: {method:'GET', isArray:false}
    });
}]);

angular.module('DashShowcaseLibrariesService', ['ngResource']).
factory('ShowcaseLibraries', ['$resource', function($resource){
    return $resource('json/showcase_libraries.json', {}, {
        query: {method:'GET', isArray:false}
    });
}]);

var app = angular.module('DashPlayer', [
    'DashSourcesService',
    'DashNotesService',
    'DashContributorsService',
    'DashPlayerLibrariesService',
    'DashShowcaseLibrariesService',
    'angularTreeview'
    ]);

app.directive('chart', function() {
    return {
        restrict: 'E',
        link: function (scope, elem, attrs) {
            var chartBuffer = null,
            optionsBuffer = {series: {shadowSize: 0},yaxis: {min: 0},xaxis: {show: false}};


            // If the data changes somehow, update it in the chart
            scope.$watch('bufferData', function(v) {
                if (v === null || v === undefined) {
                    return;
                }

                if (!chartBuffer) {
                    chartBuffer = $.plot(elem, v , optionsBuffer);
                    elem.show();
                }
                else {
                    chartBuffer.setData(v);
                    chartBuffer.setupGrid();
                    chartBuffer.draw();
                }
            });

            scope.$watch('invalidateChartDisplay', function(v) {
                if (v && chartBuffer) {
                    var data = scope[attrs.ngModel];
                    chartBuffer.setData(data);
                    chartBuffer.setupGrid();
                    chartBuffer.draw();

                    scope.invalidateDisplay(false);
                }
            });
        }
    };
});

app.directive('chart2', function() {
    return {
        restrict: 'E',
        link: function (scope, elem, attrs) {
         var chartBandwidth =  null,
         optionsBandwidth = {series: {shadowSize: 0},yaxis: {ticks: [],color:"#FFF"},xaxis: {show: false},lines: {steps: true,},grid: {markings: [],borderWidth: 0}};


            // If the data changes somehow, update it in the chart
            scope.$watch('bandwidthData', function(v) {
                if (v === null || v === undefined) {
                    return;
                }
                if (!chartBandwidth && scope.optionsBandwidthGrid) {
                    // must do a mixin between optionsBandwidth and scope.optionsBandwidthGrid
                    optionsBandwidth = angular.extend(optionsBandwidth,  scope.optionsBandwidthGrid);
                    chartBandwidth = $.plot(elem, v , optionsBandwidth);
                    elem.show();
                } else if (chartBandwidth) {
                    chartBandwidth.setData(v);
                    chartBandwidth.setupGrid();
                    chartBandwidth.draw();
                }
            });

            scope.$watch('invalidateChartDisplay', function(v) {
                if (v && chartBandwidth) {
                    var data = scope[attrs.ngModel];
                    chartBandwidth.setData(data);
                    chartBandwidth.setupGrid();
                    chartBandwidth.draw();
                    scope.invalidateDisplay(false);
                }
            });
        }
    };
});

app.controller('DashController', ['$scope', '$window', 'Sources', 'Notes','Contributors','PlayerLibraries','ShowcaseLibraries',
    function($scope, $window, Sources, Notes, Contributors, PlayerLibraries, ShowcaseLibraries) {

    var player,
        video,
        subtitlesDiv,
        context,
        config = null,
        videoSeries = [],
        dlSeries = [],
        playSeries = [],
        audioSeries = [],
        qualityChangements = [],
        previousPlayedQuality = 0,
        previousDownloadedQuality= 0,
        maxGraphPoints = 50,
        metricsAgent = null,
        configMetrics = null,
        subtitlesCSSStyle = null;

    $scope.chromecast = {};
    $scope.chromecast.apiOk = false;

    ////////////////////////////////////////
    //
    // Metrics
    //
    ////////////////////////////////////////

    $scope.videoBitrate = 0;
    $scope.videoIndex = 0;
    $scope.videoPendingIndex = "";
    $scope.videoMaxIndex = 0;
    $scope.videoBufferLength = 0;
    $scope.videoDroppedFrames = 0;
    $scope.videoWidth = 0;
    $scope.videoHeight = 0;
    $scope.videoCodecs = "-";

    $scope.audioBitrate = 0;
    $scope.audioIndex = 0;
    $scope.audioPendingIndex = "";
    $scope.audioMaxIndex = 0;
    $scope.audioBufferLength = 0;
    $scope.audioDroppedFrames = 0;
    $scope.audioCodecs = "-";

    $scope.optionsBandwidthGrid = null;

    $scope.streamTypes = ["HLS", "MSS", "DASH", "PLAYBACK"];
    $scope.streamType = "PLAYBACK";

    $scope.protectionTypes = ["PlayReady", "Widevine"];
    $scope.protectionType = (bowser.chrome || bowser.firefox) ? "Widevine" : "PlayReady";
    var protectionSchemes = ["com.microsoft.playready", "com.widevine.alpha"];
    // create blank structure for selectedItem
    $scope.selectedItem = {};
    setProtectionData();

    $('#sliderAudio').labeledslider({
        max:0,
        step:1,
        orientation:'vertical',
        range:false,
        tickLabels: [],
    });

    // reinit charts
    // assign an empty array is not working... why ? reference in bufferData ?
    videoSeries.splice(0, videoSeries.length);
    audioSeries.splice(0, audioSeries.length);
    dlSeries.splice(0, dlSeries.length);
    playSeries.splice(0, playSeries.length);

    var converter = new MetricsTreeConverter();
    $scope.videoMetrics = null;
    $scope.audioMetrics = null;
    $scope.audioTracks  = [];
    $scope.textTracks  = [];

    $scope.getVideoTreeMetrics = function () {
        var metrics = player.getMetricsFor("video");
        var metricsExt = player.getMetricsExt();
        $scope.videoMetrics = converter.toTreeViewDataSource(metrics,metricsExt);
    };

    $scope.getAudioTreeMetrics = function () {
        var metrics = player.getMetricsFor("audio");
        var metricsExt = player.getMetricsExt();
        $scope.audioMetrics = converter.toTreeViewDataSource(metrics,metricsExt);
    };

    // from: https://gist.github.com/siongui/4969449
    $scope.safeApply = function(fn) {
        var phase = this.$root.$$phase;
        if(phase == '$apply' || phase == '$digest')
            this.$eval(fn);
        else
            this.$apply(fn);
    };

    $scope.selectAudioTrack = function(track){
        player.selectTrack(MediaPlayer.TRACKS_TYPE.AUDIO,track);
    };

    $scope.selectTextTrack = function(track){
        player.selectTrack(MediaPlayer.TRACKS_TYPE.TEXT,track);
    };

    function getCribbedMetricsFor(type) {
        var metrics = player.getMetricsFor(type),
        metricsExt = player.getMetricsExt(),
        repSwitch,
        bufferLevel,
        httpRequests,
        droppedFramesMetrics,
        bitrateIndexValue,
        bandwidthValue,
        pendingValue,
        numBitratesValue,
        bitrateValues,
        bufferLengthValue = 0,
        movingLatency = {},
        movingDownload = {},
        movingRatio = {},
        droppedFramesValue = 0,
        httpRequest,
        fillmoving = function(type, Requests){
            var requestWindow,
            downloadTimes,
            latencyTimes,
            durationTimes;

            requestWindow = Requests
            .slice(-20)
            .filter(function(req){return req.responsecode >= 200 && req.responsecode < 300 && !!req.mediaduration && req.type === "Media Segment" && req.stream === type;})
            .slice(-4);
            if (requestWindow.length > 0) {

                latencyTimes = requestWindow.map(function (req){ return Math.abs(req.tresponse.getTime() - req.trequest.getTime()) / 1000;});

                movingLatency[type] = {
                    average: latencyTimes.reduce(function(l, r) {return l + r;}) / latencyTimes.length,
                    high: latencyTimes.reduce(function(l, r) {return l < r ? r : l;}),
                    low: latencyTimes.reduce(function(l, r) {return l < r ? l : r;}),
                    count: latencyTimes.length
                };

                downloadTimes = requestWindow.map(function (req){ return Math.abs(req.tfinish.getTime() - req.tresponse.getTime()) / 1000;});

                movingDownload[type] = {
                    average: downloadTimes.reduce(function(l, r) {return l + r;}) / downloadTimes.length,
                    high: downloadTimes.reduce(function(l, r) {return l < r ? r : l;}),
                    low: downloadTimes.reduce(function(l, r) {return l < r ? l : r;}),
                    count: downloadTimes.length
                };

                durationTimes = requestWindow.map(function (req){ return req.mediaduration;});

                movingRatio[type] = {
                    average: (durationTimes.reduce(function(l, r) {return l + r;}) / downloadTimes.length) / movingDownload[type].average,
                    high: durationTimes.reduce(function(l, r) {return l < r ? r : l;}) / movingDownload[type].low,
                    low: durationTimes.reduce(function(l, r) {return l < r ? l : r;}) / movingDownload[type].high,
                    count: durationTimes.length
                };
            }
        };

        if (metrics && metricsExt) {
            repSwitch = metricsExt.getCurrentRepresentationSwitch(metrics);
            bufferLevel = metricsExt.getCurrentBufferLevel(metrics);
            httpRequests = metricsExt.getHttpRequests(metrics);
            droppedFramesMetrics = metricsExt.getCurrentDroppedFrames(metrics);

            fillmoving("video", httpRequests);
            fillmoving("audio", httpRequests);

            httpRequest = (httpRequests.length > 0) ? httpRequests[httpRequests.length - 1] : null;

            if (repSwitch !== null) {
                bitrateIndexValue = metricsExt.getIndexForRepresentation(repSwitch.to);
                bandwidthValue = metricsExt.getBandwidthForRepresentation(repSwitch.to);
                bandwidthValue = bandwidthValue / 1000;
                bandwidthValue = Math.round(bandwidthValue);
            }

            numBitratesValue = metricsExt.getMaxIndexForBufferType(type);
            bitrateValues = metricsExt.getBitratesForType(type);

            if (bufferLevel !== null) {
                bufferLengthValue = bufferLevel.level.toPrecision(5);
            }

            if (droppedFramesMetrics !== null) {
                droppedFramesValue = droppedFramesMetrics.droppedFrames;
            }

            if (isNaN(bandwidthValue) || bandwidthValue === undefined) {
                bandwidthValue = 0;
            }

            if (isNaN(bitrateIndexValue) || bitrateIndexValue === undefined) {
                bitrateIndexValue = 0;
            }

            if (isNaN(numBitratesValue) || numBitratesValue === undefined) {
                numBitratesValue = 0;
            }

            if (isNaN(bufferLengthValue) || bufferLengthValue === undefined) {
                bufferLengthValue = 0;
            }

            pendingValue = player.getQualityFor(type);
            return {
                bandwidthValue: bandwidthValue,
                bitrateIndexValue: bitrateIndexValue + 1,
                pendingIndex: (pendingValue !== bitrateIndexValue) ? "(-> " + (pendingValue + 1) + ")" : "",
                numBitratesValue: numBitratesValue,
                bitrateValues : bitrateValues,
                bufferLengthValue: bufferLengthValue,
                droppedFramesValue: droppedFramesValue,
                movingLatency: movingLatency,
                movingDownload: movingDownload,
                movingRatio: movingRatio,
                httpRequest: httpRequest
            };
        }
        else {
            return null;
        }
    }

    function onload(/*e*/) {
        //init audio tracks
        $scope.audioTracks = player.getTracks(MediaPlayer.TRACKS_TYPE.AUDIO);
        if ($scope.audioTracks !== null) {
            $scope.audioData = $scope.audioTracks[0];
        }

        //init subtitles tracks
        player.enableSubtitles(true);
        $scope.textTracks = player.getTracks(MediaPlayer.TRACKS_TYPE.TEXT);
        if ($scope.textTracks !== null) {
            $scope.textData = $scope.textTracks[0];
        }
    }

    function onplay(/*e*/) {
        $scope.trickModeSpeed = "x1";
    }

    //if video size change, player has to update subtitles size
    function onFullScreenChange(){
    }

    function onManifestUrlUpdate(){
        player.refreshManifest($scope.selectedItem.url);
    }

    function metricChanged(e) {
        var metrics,
        point;

        if (e.data.stream == "video") {
            metrics = getCribbedMetricsFor("video");
            if (metrics) {
                $scope.videoBitrate = metrics.bandwidthValue;
                $scope.videoIndex = metrics.bitrateIndexValue;
                $scope.videoPendingIndex = metrics.pendingIndex;
                $scope.videoMaxIndex = metrics.numBitratesValue;
                $scope.videoBufferLength = metrics.bufferLengthValue;
                $scope.videoDroppedFrames = metrics.droppedFramesValue;

                if (metrics.movingLatency['video']) {
                    $scope.videoLatencyCount = metrics.movingLatency['video'].count;
                    $scope.videoLatency = metrics.movingLatency['video'].low.toFixed(3) + " < " + metrics.movingLatency['video'].average.toFixed(3) + " < " + metrics.movingLatency['video'].high.toFixed(3);
                }
                if (metrics.movingDownload['video']) {
                    $scope.videoDownloadCount = metrics.movingDownload['video'].count;
                    $scope.videoDownload = metrics.movingDownload['video'].low.toFixed(3) + " < " + metrics.movingDownload['video'].average.toFixed(3) + " < " + metrics.movingDownload['video'].high.toFixed(3);
                }
                if (metrics.movingRatio['video']) {
                    $scope.videoRatioCount = metrics.movingRatio['video'].count;
                    $scope.videoRatio = metrics.movingRatio['video'].low.toFixed(3) + " < " + metrics.movingRatio['video'].average.toFixed(3) + " < " + metrics.movingRatio['video'].high.toFixed(3);
                }

                if ($('#sliderBitrate').labeledslider( "option", "max" ) === 0 && metrics.numBitratesValue>0) {
                    var labels = [];
                    for (var i = 0; metrics.bitrateValues!= null && i < metrics.bitrateValues.length; i++) {
                        labels.push(Math.round(metrics.bitrateValues[i] / 1000) + "k");
                    }

                    $('#sliderBitrate').labeledslider({ max: (metrics.numBitratesValue - 1), step: 1, values: [ 0, (metrics.numBitratesValue - 1 )], tickLabels: labels});
                    $('#sliderBitrate').labeledslider({stop: function( event, ui ) {
                        player.setConfig( {
                            "video": {
                                "ABR.minQuality": ui.values[0],
                                "ABR.maxQuality": ui.values[1]
                            }
                        });
                    }});
                }

                // case of downloaded quality change
                if ((metrics.httpRequest !== null)  && (metrics.bitrateValues!== null && (metrics.bitrateValues[metrics.httpRequest.quality] != previousDownloadedQuality))) {
                // save quality change for later when video currentTime = mediaStartTime
                qualityChangements.push({
                    mediaStartTime : metrics.httpRequest.startTime,
                    switchedQuality : metrics.bitrateValues[metrics.httpRequest.quality],
                    downloadStartTime : metrics.httpRequest.trequest
                });
                previousDownloadedQuality = metrics.bitrateValues[metrics.httpRequest.quality];
            }

            for (var p in qualityChangements) {
                var currentQualityChangement = qualityChangements[p];
                //time of downloaded quality change
                if (currentQualityChangement.downloadStartTime <= video.currentTime) {
                    previousDownloadedQuality = currentQualityChangement.switchedQuality;
                }

                // time of played quality change !
                if (currentQualityChangement.mediaStartTime <= video.currentTime) {
                    previousPlayedQuality = currentQualityChangement.switchedQuality;
                    qualityChangements.splice(p,1);
                }
            }

            var dlPoint = [video.currentTime, Math.round(previousDownloadedQuality/1000)];
            dlSeries.push(dlPoint);
            var playPoint = [video.currentTime, Math.round(previousPlayedQuality / 1000)];
            playSeries.push(playPoint);

            videoSeries.push([parseFloat(video.currentTime), Math.round(parseFloat(metrics.bufferLengthValue))]);

            if (videoSeries.length > maxGraphPoints) {
                videoSeries.splice(0, 1);
            }

            if (dlSeries.length > maxGraphPoints) {
                dlSeries.splice(0, 1);
                playSeries.splice(0, 1);
            }

            //initialisation of bandwidth chart
            if (!$scope.optionsBandwidthGrid) {
                // $scope.optionsBandwidth.xaxis.min = video.currentTime;
                $scope.optionsBandwidthGrid = {};
                $scope.optionsBandwidthGrid.grid = {markings:[]};
                $scope.optionsBandwidthGrid.yaxis = {ticks: []};
                for (var idx in metrics.bitrateValues) {
                    $scope.optionsBandwidthGrid.grid.markings.push({yaxis: { from: metrics.bitrateValues[idx]/1000, to: metrics.bitrateValues[idx]/1000 },color:"#b0b0b0"});
                    $scope.optionsBandwidthGrid.yaxis.ticks.push([metrics.bitrateValues[idx]/1000, ""+metrics.bitrateValues[idx]/1000+"k"]);
                }
                $scope.optionsBandwidthGrid.yaxis.min = Math.min.apply(null,metrics.bitrateValues)/1000;
                $scope.optionsBandwidthGrid.yaxis.max = Math.max.apply(null,metrics.bitrateValues)/1000;
            }
        }
    }

    if (e.data.stream == "audio") {
        metrics = getCribbedMetricsFor("audio");
        if (metrics) {

            $scope.audioBitrate = metrics.bandwidthValue;
            $scope.audioIndex = metrics.bitrateIndexValue;
            $scope.audioPendingIndex = metrics.pendingIndex;
            $scope.audioMaxIndex = metrics.numBitratesValue;
            $scope.audioBufferLength = metrics.bufferLengthValue;
            $scope.audioDroppedFrames = metrics.droppedFramesValue;
            if (metrics.movingLatency['audio']) {
                $scope.audioLatencyCount = metrics.movingLatency['audio'].count;
                $scope.audioLatency = metrics.movingLatency['audio'].low.toFixed(3) + " < " + metrics.movingLatency['audio'].average.toFixed(3) + " < " + metrics.movingLatency['audio'].high.toFixed(3);
            }
            if (metrics.movingDownload['audio']) {
                $scope.audioDownloadCount = metrics.movingDownload['audio'].count;
                $scope.audioDownload = metrics.movingDownload["audio"].low.toFixed(3) + " < " + metrics.movingDownload['audio'].average.toFixed(3) + " < " + metrics.movingDownload['audio'].high.toFixed(3);
            }
            if (metrics.movingRatio['audio']) {
                $scope.audioRatioCount = metrics.movingRatio['audio'].count;
                $scope.audioRatio = metrics.movingRatio['audio'].low.toFixed(3) + " < " + metrics.movingRatio['audio'].average.toFixed(3) + " < " + metrics.movingRatio['audio'].high.toFixed(3);
            }

            point = [parseFloat(video.currentTime), Math.round(parseFloat(metrics.bufferLengthValue))];
            audioSeries.push(point);

            if (audioSeries.length > maxGraphPoints) {
                audioSeries.splice(0, 1);
            }
        }
    }
    $scope.invalidateDisplay(true);
    $scope.safeApply();
}

    ////////////////////////////////////////
    //
    // Error Handling
    //
    ////////////////////////////////////////

    function onError(e) {

        console.error("ERROR: " + JSON.stringify(e));

        if (e.data.code != "HASPLAYER_INIT_ERROR") {
            //stop
            player.reset(2);
            if (metricsAgent) {
                metricsAgent.stop();
            }
        }

        //alert('ERROR - '  + e.data.code + ":\n" + JSON.stringify(e, null, '  '));
        alert(e.data.code);
    }

    ////////////////////////////////////////
    //
    // Debugging
    //
    ////////////////////////////////////////

    $scope.invalidateChartDisplay = false;

    $scope.invalidateDisplay = function (value) {
        $scope.invalidateChartDisplay = value;
    };

    $scope.bandwidthData = [{
        data: dlSeries,
        label: "download",
        color: "#2980B9"
    }, {
        data: playSeries,
        label: "playing",
        color: "#E74C3C"
    }];

    $scope.bufferData = [
    {
        data:videoSeries,
        label: "Taille du buffer Vidéo",
        color: "#2980B9"
    },
    {
        data: audioSeries,
        label: "Taille du buffer Audio",
        color: "#E74C3C"
    }
    ];

    $scope.showCharts = false;
    $scope.setCharts = function (show) {
        $scope.showCharts = show;
    };

    $scope.switchCharts = false;
    $scope.setSwitchCharts = function (firstOrSecond) {
        $scope.setCharts(true);
        $scope.switchCharts = firstOrSecond;
    };

    $scope.showDebug = false;
    $scope.setDebug = function (show) {
        $scope.showDebug = show;
    };

    ////////////////////////////////////////
    //
    // Configuration file
    //
    ////////////////////////////////////////
    var reqConfig = new XMLHttpRequest();
    reqConfig.onload = function() {
        if (reqConfig.status === 200) {
            config = JSON.parse(reqConfig.responseText);
            if (player) {
                player.setConfig(config);
            }
        }
    };
    reqConfig.open("GET", "hasplayer_config.json", true);
    reqConfig.setRequestHeader("Content-type", "application/json");
    reqConfig.send();

    ////////////////////////////////////////
    //
    // Player Setup
    //
    ////////////////////////////////////////
    video = document.querySelector(".dash-video-player video");
    subtitlesDiv = document.querySelector(".subtitlesDiv");
    player = new MediaPlayer();

    // link reference between mediaPlayer and player object
    mediaPlayer = player;
    $scope.version = player.getVersion();
    $scope.versionFull = player.getVersionFull();
    $scope.versionDashJS = player.getVersionDashJS();
    $scope.buildDate = player.getBuildDate();


    player.init(video);
    player.addEventListener("error", onError.bind(this));
    player.addEventListener("metricChanged", metricChanged.bind(this));
    player.addEventListener("manifestUrlUpdate", onManifestUrlUpdate.bind(this));
    video.addEventListener("loadeddata", onload.bind(this));
    video.addEventListener("play", onplay.bind(this));
    video.addEventListener("fullscreenchange", onFullScreenChange.bind(this));
    video.addEventListener("mozfullscreenchange", onFullScreenChange.bind(this));
    video.addEventListener("webkitfullscreenchange", onFullScreenChange.bind(this));
    player.setAutoPlay(true);
    player.getDebug().setLevel(4);
    if (config) {
        player.setConfig(config);
    }
    $scope.player = player;
    $scope.videojsIsOn = false;

    $scope.activateVideoJS = function() {
        if(!$scope.videojsIsOn) {
            videojs(video, { "controls": true, "autoplay": true, "preload": "auto" });
        }
        $scope.videojsIsOn = true;
    };

    ////////////////////////////////////////
    //
    // Player Methods
    //
    ////////////////////////////////////////

    $scope.abrEnabled = true;

    $scope.setAbrEnabled = function (enabled) {
        $scope.abrEnabled = enabled;
        player.setAutoSwitchQuality(enabled);
    };

    $scope.abrUp = function (type) {
        var newQuality,
        metricsExt = player.getMetricsExt(),
        max = metricsExt.getMaxIndexForBufferType(type);

        newQuality = player.getQualityFor(type) + 1;
        // zero based
        if (newQuality >= max) {
            newQuality = max - 1;
        }
        player.setQualityFor(type, newQuality);
    };

    $scope.abrDown = function (type) {
        var newQuality = player.getQualityFor(type) - 1;
        if (newQuality < 0) {
            newQuality = 0;
        }
        player.setQualityFor(type, newQuality);
    };

    $scope.playbackRateUp = function () {

        if (video.playbackRate === 64.0) {
            return;
        }

        video.playbackRate = video.playbackRate * 2;
        $scope.playbackRate = "x" + video.playbackRate;
        player.setAutoSwitchQuality(false);
        player.setQualityFor('video', 0);
    };

    $scope.playbackRateDown = function () {

        if (video.playbackRate < 0.1) {
            return;
        }

        video.playbackRate = video.playbackRate / 2;
        $scope.playbackRate = "x" + video.playbackRate;

        if (video.playbackRate < 0.1) {
            player.setAutoSwitchQuality(true);
        }
    };

    $scope.trickModeSpeedUp = function () {
        var currentSpeed = player.getTrickModeSpeed(),
            newSpeed;

        if (currentSpeed === 128.0) {
            return;
        }

        newSpeed = (currentSpeed < 0) ? 1 : (currentSpeed * 2);

        player.setTrickModeSpeed(newSpeed);
        $scope.trickModeSpeed = "x" + newSpeed;
    };

    $scope.trickModeSpeedDown = function () {
        var currentSpeed = player.getTrickModeSpeed(),
            newSpeed;

        if (currentSpeed === -128.0) {
            return;
        }

        newSpeed = (currentSpeed === 1) ? -2 : ((currentSpeed > 1) ? (currentSpeed / 2) : (currentSpeed * 2));

        player.setTrickModeSpeed(newSpeed);
        $scope.trickModeSpeed = "x" + newSpeed;
    };

    ////////////////////////////////////////
    //
    // Page Setup
    //
    ////////////////////////////////////////

    $scope.selectStreams = function () {
        $scope.availableStreams = $scope.streams.filter(function(item) {
            return (item.protocol === $scope.streamType);
        });
    };

    function getUrlVars() {
        var vars = {};
        var parts = window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(m,key,value) {
            vars[key] = value;
        });
        return vars;
    }

    // Get url params...
    var vars = getUrlVars(),
    browserVersion,
    filterValue;

    if (vars && vars.hasOwnProperty("version")) {
        browserVersion = vars.version;
    }
    else {
        browserVersion = "stable";
    }

    switch(browserVersion) {
        case "beta":
        filterValue = "b";
        break;
        case "canary":
        filterValue = "c";
        break;
        case "dev":
        filterValue = "d";
        break;
        case "explorer":
        filterValue = "i";
        break;
        case "all":
        filterValue = "a";
        break;
        case "stable":
        default:
        filterValue = "s";
        break;
    }

    $scope.isStreamAvailable = function (str) {
        if (filterValue === "a") {
            return true;
        }
        else {
            return (str.indexOf(filterValue) != -1);
        }
    };

    if(window.jsonData === undefined) {
        Sources.query(function (data) {
            $scope.streams = data.items;
            $scope.selectStreams();
        });

        Notes.query(function (data) {
            $scope.releaseNotes = data.notes;
        });

        Contributors.query(function (data) {
            $scope.contributors = data.items;
        });

        PlayerLibraries.query(function (data) {
            $scope.playerLibraries = data.items;
        });

        ShowcaseLibraries.query(function (data) {
            $scope.showcaseLibraries = data.items;
        });
    } else {
        $scope.streams = window.jsonData.sources.items;
        $scope.releaseNotes = window.jsonData.notes.notes;
        $scope.contributors = window.jsonData.contributors.items;
        $scope.playerLibraries = window.jsonData.player_libraries.items;
        $scope.showcaseLibraries = window.jsonData.showcase_libraries.items;
        $scope.selectStreams();
    }


    $scope.setStreamType = function (item) {
        $scope.streamType = item;
        $scope.availableStreams = $scope.streams.filter(function(item) {
            return (item.protocol === $scope.streamType);
        });
    };

    $scope.setStream = function (item) {
        $scope.selectedItem = item;
        setProtectionData();
    };

    function setProtectionScheme () {
        switch ($scope.protectionType) {
            case "PlayReady":
                $scope.protectionScheme = "com.microsoft.playready";
                break;
            case "Widevine":
                $scope.protectionScheme = "com.widevine.alpha";
                break;
        }
    }

    $scope.setProtectionType = function (item) {
        $scope.protectionType = item;
        setProtectionScheme();
    };

    function setProtectionData () {
        if(!$scope.selectedItem.protData){
            $scope.selectedItem.protData = {};
        }
        for(var i=0; i< protectionSchemes.length; i++){
            if(!$scope.selectedItem.protData[protectionSchemes[i]]){
                $scope.selectedItem.protData[protectionSchemes[i]] = {};
            }
        }
    }

    setProtectionScheme();


    function resetBitratesSlider () {
        $('#sliderBitrate').labeledslider({
            max: 0,
            step: 1,
            values: [0],
            tickLabels: [],
            orientation: 'vertical',
            range: true,
            stop: function(evt, ui) {
                player.setConfig({
                    "video": {
                        "ABR.minQuality": ui.values[0],
                        "ABR.maxQuality": ui.values[1]
                    }
                });
            }
        });
    }

    function initPlayer() {
        resetBitratesSlider();
        //ORANGE : reset subtitles data.
        $scope.textTracks = null;
        $scope.textData = null;

        // ORANGE: reset ABR controller
        player.setInitialQualityFor("video", 0);
        player.setInitialQualityFor("audio", 0);

        //player.attachTTMLRenderingDiv(subtitlesDiv);

        $scope.playbackRate = "x1";
        localStorage.setItem("url",$scope.selectedItem.url);
        localStorage.setItem("laurl",$scope.selectedItem.protData['com.widevine.alpha'].laURL);
        player.load($scope.selectedItem);
    }

    $scope.doLoad = function () {
        if ($scope.chromecast.playing){
            $scope.stopInChromecast();
        }

        player.reset(0);

        initPlayer();
    };

    $scope.loadInPlayer = function(url) {
        var demoPlayer;

        if(window.jsonData === undefined) {
            demoPlayer = '../DemoPlayer/index.html?url=';
        } else {
            demoPlayer = 'player.html?url=';
        }

        $window.open(demoPlayer+url);
    };

    $scope.hasLogo = function (item) {
        return (item.hasOwnProperty("logo") && item.logo !== null && item.logo !== undefined && item.logo !== "");
    };

    // Get initial stream if it was passed in.
    if (vars && vars.hasOwnProperty("url")) {
        $scope.selectedItem.url = vars.url.indexOf("%3A")>0?decodeURIComponent(vars.url):vars.url;
    }
    else if (vars && vars.hasOwnProperty("mpd")) {
        $scope.selectedItem.url = vars.mpd;
    }
    else if(localStorage.getItem("url")) {
        $scope.selectedItem.url = localStorage.getItem("url");
    }

    if (vars && vars.hasOwnProperty("stream")) {
        try {
            $scope.selectedItem = JSON.parse(atob(vars.stream));
            setProtectionData();
        } catch (e) {}
    }

    if (vars && vars.hasOwnProperty("startTime") && $scope.selectedItem) {
        $scope.selectedItem.startTime = vars.startTime;
    }

    if (vars && vars.hasOwnProperty("laurl")) {
        $scope.selectedItem.protData[$scope.protectionScheme].laURL = vars.laurl.indexOf("%3A")>0?decodeURIComponent(vars.laurl):vars.laurl;
        $scope.selectedItem.protData['com.widevine.alpha'].laURL = vars.laurl.indexOf("%3A")>0?decodeURIComponent(vars.laurl):vars.laurl;
    }
    else if(localStorage.getItem("laurl")) {
         $scope.selectedItem.protData['com.widevine.alpha'].laURL = localStorage.getItem("laurl");
    }

    if (vars && vars.hasOwnProperty("autoplay") && vars.autoplay === 'true' && $scope.selectedItem.url) {
        $scope.doLoad();
    }

}]);
