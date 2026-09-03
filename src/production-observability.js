const PROVIDERS = ['satcorps', 'gmgsi'];

function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid production health field: ${path}`);
  return value;
}

function number(value, path, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid production health field: ${path}`);
  return value;
}

function timestamp(value, path) {
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) throw new Error(`Invalid production health field: ${path}`);
  return milliseconds;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') throw new Error(`Invalid production health field: ${path}`);
  return value;
}

function string(value, path) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid production health field: ${path}`);
  return value;
}

function fraction(value, path) {
  number(value, path);
  if (value > 1) throw new Error(`Invalid production health field: ${path}`);
  return value;
}

function dimensionsEqual(left, right) {
  return left.width === right.width && left.height === right.height;
}

function providerMetrics(provider, observation, rules, checkedAt) {
  record(observation, `providers.${provider}`);
  record(rules, `policy.providers.${provider}`);
  const latestObservationAt = timestamp(observation.latestObservationAt, `providers.${provider}.latestObservationAt`);
  const discoveredAt = timestamp(observation.discoveredAt, `providers.${provider}.discoveredAt`);
  const dimensions = record(observation.dimensions, `providers.${provider}.dimensions`);
  const expectedDimensions = record(observation.expectedDimensions, `providers.${provider}.expectedDimensions`);
  for (const [name, value] of Object.entries({ ...dimensions, expectedWidth: expectedDimensions.width, expectedHeight: expectedDimensions.height })) {
    number(value, `providers.${provider}.dimensions.${name}`, 1);
  }
  if (!Array.isArray(observation.qualityFlags) || observation.qualityFlags.some(flag => typeof flag !== 'string')) {
    throw new Error(`Invalid production health field: providers.${provider}.qualityFlags`);
  }
  return {
    discoveryLatencyMinutes: (discoveredAt - latestObservationAt) / 60_000,
    temporalInvalid: latestObservationAt > discoveredAt || discoveredAt > checkedAt || latestObservationAt > checkedAt,
    missingObservations: number(observation.missingObservations, `providers.${provider}.missingObservations`),
    schemaDrift: string(observation.schemaFingerprint, `providers.${provider}.schemaFingerprint`)
      !== string(observation.expectedSchemaFingerprint, `providers.${provider}.expectedSchemaFingerprint`),
    dimensionsChanged: !dimensionsEqual(dimensions, expectedDimensions),
    corruptProducts: number(observation.corruptProducts, `providers.${provider}.corruptProducts`),
    coverageFraction: fraction(observation.coverageFraction, `providers.${provider}.coverageFraction`),
    qualityFlags: [...observation.qualityFlags],
    processingDurationMs: number(observation.processingDurationMs, `providers.${provider}.processingDurationMs`),
  };
}

function alert(stage, code, detail, extra = {}) {
  return { stage, code, detail, ...extra };
}

export function evaluateEarthProductionHealth(snapshot, policy) {
  record(snapshot, 'snapshot');
  record(policy, 'policy');
  const checkedAt = timestamp(snapshot.checkedAt, 'checkedAt');
  const alerts = [];
  const providers = {};
  for (const provider of PROVIDERS) {
    const rules = policy.providers?.[provider];
    const metrics = providerMetrics(provider, snapshot.providers?.[provider], rules, checkedAt);
    providers[provider] = metrics;
    if (metrics.temporalInvalid) {
      alerts.push(alert('upstream-provider-lateness', 'provider-time-invalid', `${provider} observation timestamps are future-dated or out of order`, { provider }));
    }
    if (metrics.discoveryLatencyMinutes > number(rules.maximumDiscoveryLatencyMinutes, `policy.providers.${provider}.maximumDiscoveryLatencyMinutes`)
      || metrics.missingObservations > number(rules.maximumMissingObservations, `policy.providers.${provider}.maximumMissingObservations`)) {
      alerts.push(alert('upstream-provider-lateness', 'provider-late-or-missing', `${provider} observations are late or missing`, { provider }));
    }
    if (metrics.schemaDrift || metrics.dimensionsChanged || metrics.corruptProducts > 0
      || metrics.coverageFraction < fraction(rules.minimumCoverageFraction, `policy.providers.${provider}.minimumCoverageFraction`)
      || metrics.qualityFlags.length > 0) {
      alerts.push(alert('transformation', 'provider-product-rejected', `${provider} source shape, integrity, coverage, or quality changed`, { provider }));
    }
  }

  const transformation = record(snapshot.transformation, 'transformation');
  const compositor = record(snapshot.compositor, 'compositor');
  const publication = record(snapshot.publication, 'publication');
  const delivery = record(snapshot.delivery, 'delivery');
  const client = record(snapshot.client, 'client');
  const visualSmoke = record(client.visualSmoke, 'client.visualSmoke');
  if (!Array.isArray(visualSmoke.artifacts) || visualSmoke.artifacts.some(path => typeof path !== 'string')) {
    throw new Error('Invalid production health field: client.visualSmoke.artifacts');
  }

  if (!boolean(transformation.ok, 'transformation.ok')) {
    alerts.push(alert('transformation', 'transformation-failed', transformation.error ?? 'Transformation failed'));
  }
  if (!boolean(compositor.ok, 'compositor.ok')) {
    alerts.push(alert('compositor', 'compositor-failed', compositor.error ?? 'Compositor failed'));
  }
  if (!['published', 'unchanged'].includes(publication.outcome)) {
    alerts.push(alert('publication', 'publication-failed', `Publication outcome was ${publication.outcome}`));
  }
  const originAvailable = boolean(delivery.originAvailable, 'delivery.originAvailable');
  const cdnAvailable = boolean(delivery.cdnAvailable, 'delivery.cdnAvailable');
  if (!originAvailable || !cdnAvailable || delivery.originBundleId !== delivery.cdnBundleId) {
    alerts.push(alert('delivery', 'latest-delivery-failed', 'Origin and CDN do not expose the same available latest bundle'));
  }
  // Where no separate origin pointer is observed, the CDN pointer is the only
  // delivered truth there is, and currentness must be judged against it rather
  // than against a placeholder nobody measured.
  const deliveredBundleId = originAvailable ? delivery.originBundleId : delivery.cdnBundleId;
  if (publication.bundleId !== deliveredBundleId) {
    alerts.push(alert('delivery', 'published-bundle-not-delivered', 'The publisher, origin, and CDN do not expose one bundle identity'));
  }
  const latestManifestRetrievedAt = timestamp(delivery.latestManifestRetrievedAt, 'delivery.latestManifestRetrievedAt');
  const latestManifestAdvancedAt = timestamp(delivery.latestManifestAdvancedAt, 'delivery.latestManifestAdvancedAt');
  const latestManifestRetrievalAgeMinutes = (checkedAt - latestManifestRetrievedAt) / 60_000;
  const latestBundleAgeMinutes = (checkedAt - latestManifestAdvancedAt) / 60_000;
  if (latestManifestRetrievalAgeMinutes < 0) {
    alerts.push(alert('client-currentness', 'latest-retrieval-time-invalid', 'The latest-pointer retrieval time is in the future'));
  }
  if (latestManifestAdvancedAt > latestManifestRetrievedAt) {
    alerts.push(alert('publication', 'latest-chronology-invalid', 'The latest bundle claims advancement after the pointer was retrieved'));
  } else if (latestBundleAgeMinutes < 0) {
    alerts.push(alert('publication', 'latest-advancement-time-invalid', 'The latest bundle advancement time is in the future'));
  } else if (latestBundleAgeMinutes > number(policy.maximumLatestManifestAgeMinutes, 'policy.maximumLatestManifestAgeMinutes')) {
    alerts.push(alert('client-currentness', 'latest-content-stale', 'The delivered latest bundle has not advanced within policy'));
  }
  const visualOk = boolean(visualSmoke.ok, 'client.visualSmoke.ok');
  if (client.bundleId !== deliveredBundleId || !visualOk) {
    alerts.push(alert('client-currentness', 'client-not-current', visualSmoke.error ?? 'Client is stale or visual smoke failed'));
  }

  // A stage whose evidence this deployment does not publish cannot be judged.
  // Waiving it is a recorded decision, not a silence: the alert is still raised
  // and still reported, it just does not fail a run that nothing could ever pass.
  // The waiver text in the policy says why, the way the cryosphere waiver does.
  const waivedStages = new Set(Array.isArray(policy.waivedStages) ? policy.waivedStages : []);
  const waived = alerts.filter(item => waivedStages.has(item.stage));
  const enforced = alerts.filter(item => !waivedStages.has(item.stage));

  return {
    schemaVersion: 1,
    checkedAt: new Date(checkedAt).toISOString().replace('.000Z', 'Z'),
    status: enforced.length === 0 ? 'healthy' : 'failing',
    metrics: {
      providers,
      transformation: { ok: transformation.ok, durationMs: number(transformation.durationMs, 'transformation.durationMs') },
      compositor: { ok: compositor.ok, durationMs: number(compositor.durationMs, 'compositor.durationMs') },
      publication: {
        outcome: string(publication.outcome, 'publication.outcome'),
        durationMs: number(publication.durationMs, 'publication.durationMs'),
        bundleId: string(publication.bundleId, 'publication.bundleId'),
      },
      delivery: {
        originAvailable,
        cdnAvailable,
        originBundleId: string(delivery.originBundleId, 'delivery.originBundleId'),
        cdnBundleId: string(delivery.cdnBundleId, 'delivery.cdnBundleId'),
      },
      latestManifestRetrievalAgeMinutes,
      latestBundleAgeMinutes,
      client: {
        bundleId: string(client.bundleId, 'client.bundleId'),
        visualSmokeOk: visualOk,
        visualArtifacts: [...visualSmoke.artifacts],
      },
    },
    alerts: enforced,
    waivedAlerts: waived,
    ...(waivedStages.size > 0 && typeof policy.waiver === 'string' ? { waiver: policy.waiver } : {}),
  };
}
