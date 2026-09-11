// Preferred location helpers are shared by the readable intake source and its tests.
const MAX_PREFERRED_LOCATIONS = 5;
const PREFERRED_COUNTRIES = new Set([
  "united states", "canada", "mexico", "romania", "european union", "remote",
]);
export const isPreferredCountry = (value = "") => PREFERRED_COUNTRIES.has(value.toLowerCase());
const WORK_MODE_ORDER = ["onsite", "hybrid", "remote"];
const WORK_MODES = new Set(WORK_MODE_ORDER);

const cleanLocation = (location = {}) => ({
  city: String(location.city || "").trim(),
  state: String(location.state || "").trim(),
  country: String(location.country || "").trim(),
});

const isCompleteLocation = (location) =>
  Boolean(location.country && (!location.city || location.state));

const locationKey = (location) =>
  [location.city, location.state, location.country].join("|").toLocaleLowerCase();

export const normalizePreferredLocations = (profile = {}) => {
  const explicit = Array.isArray(profile.preferredLocations)
    ? profile.preferredLocations
    : [];
  const candidates = explicit.length ? explicit : [profile];

  return candidates.reduce((locations, candidate) => {
    const location = cleanLocation(candidate);
    if (!isCompleteLocation(location)) return locations;
    if (locations.some((existing) => locationKey(existing) === locationKey(location))) {
      return locations;
    }
    return [...locations, location];
  }, []);
};

export const addPreferredLocation = (locations, candidate) => {
  const current = normalizePreferredLocations({ preferredLocations: locations });
  const next = cleanLocation(candidate);
  if (!isCompleteLocation(next) || current.length >= MAX_PREFERRED_LOCATIONS) {
    return current;
  }
  if (current.some((location) => locationKey(location) === locationKey(next))) {
    return current;
  }
  return [...current, next];
};

export const removePreferredLocation = (locations, candidate) => {
  const removeKey = locationKey(cleanLocation(candidate));
  return normalizePreferredLocations({ preferredLocations: locations }).filter(
    (location) => locationKey(location) !== removeKey,
  );
};

export const formatPreferredLocation = ({ city, state, country }) =>
  [city, state, country].filter(Boolean).join(", ");

export const hasRemoteLocation = (profile = {}) =>
  normalizePreferredLocations(profile).some(({ country }) => country.toLowerCase() === "remote");

export const serializePreferredLocations = (locations) =>
  normalizePreferredLocations({ preferredLocations: locations })
    .map(formatPreferredLocation)
    .join("; ");

export const parsePreferredLocations = (value) =>
  normalizePreferredLocations({
    preferredLocations: String(value || "")
      .split(/;|\n/)
      .map((entry) => {
        const parts = entry.split(",").map((part) => part.trim());
        if (parts.length > 3 || (parts.length < 3 && !isPreferredCountry(parts.at(-1)))) return {};
        const [country = "", state = "", city = ""] = parts.reverse();
        return { city, state, country };
      }),
  });

export const normalizeWorkModes = (profile = {}) => {
  if (hasRemoteLocation(profile)) return ["remote"];
  const explicit = Array.isArray(profile.workModes)
    ? profile.workModes
    : String(profile.workModes || "")
        .split(",")
        .map((mode) => mode.trim())
        .filter(Boolean);
  const valid = new Set(explicit.filter((mode) => WORK_MODES.has(mode)));
  if (valid.size) return WORK_MODE_ORDER.filter((mode) => valid.has(mode));
  if (WORK_MODES.has(profile.workMode)) return [profile.workMode];
  return [profile.remote ? "remote" : "hybrid"];
};

export const toggleWorkMode = (workModes, workMode) => {
  const current = normalizeWorkModes({ workModes });
  if (!WORK_MODES.has(workMode)) return current;
  if (current.includes(workMode)) {
    return current.length === 1 ? current : current.filter((mode) => mode !== workMode);
  }
  const selected = new Set([...current, workMode]);
  return WORK_MODE_ORDER.filter((mode) => selected.has(mode));
};
