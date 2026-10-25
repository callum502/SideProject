// Validates the profile form. Height is in centimetres (30–333 cm, 1 ft to 10 ft 11 in); ape index is in inches,
// or null for Not sure.
export function profileDetails(values) {
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const height = Number(values.height);
  const ape =
    values.apeIndex === 'unknown' || values.apeIndex === '' || values.apeIndex == null ? null : Number(values.apeIndex);
  if (
    !name ||
    name.length > 120 ||
    !Number.isInteger(height) ||
    height < 30 ||
    height > 333 ||
    (ape !== null && (!Number.isInteger(ape) || ape < -8 || ape > 8))
  )
    throw Object.assign(
      new Error('Enter a display name, height (1 ft to 10 ft 11 in), and an ape index or Not sure (−8 to +8 inches).'),
      { status: 400 }
    );
  return { name, height, apeIndex: ape };
}
