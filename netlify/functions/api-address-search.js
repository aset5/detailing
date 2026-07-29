exports.handler = async (event) => {
  const query = event.queryStringParameters?.q?.trim();
  if (!query || query.length < 2) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([])
    };
  }

  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&components=country:us&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.predictions?.length) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data.predictions.map(p => ({ address: p.description })))
        };
      }
    } catch (err) {
      console.error('[Address] Google API error:', err.message);
    }
  }

  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en&lat=40.4406&lon=-79.9959`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'GlowOnTheGo/1.0' }
    });
    const data = await response.json();
    const results = (data.features || []).map(feature => {
      const p = feature.properties || {};
      const parts = [
        [p.housenumber, p.street].filter(Boolean).join(' '),
        p.city || p.town || p.village || p.district,
        p.state,
        p.postcode,
        p.country
      ].filter(Boolean);
      const address = parts.join(', ');
      return address ? { address } : null;
    }).filter(Boolean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results)
    };
  } catch {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([])
    };
  }
};
