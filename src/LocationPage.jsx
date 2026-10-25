import React from 'react';
import { validLocationLinks } from '../shared/location-links.mjs';
import { CreatorLink } from './PublicProfile';
import { Icon, countLabel } from './ui';

// A location's page: its banner, coordinates and approach, parking photos, boulders and links.
export default function LocationPage({ place, user, busy, canEdit, upload, choose, setModal, setError, navigation }) {
  return (
    <>
      <div className="detail-banner">
        {navigation}
        <div className="eyebrow">
          <Icon name="pin" /> CLIMBING LOCATION
        </div>
        <h2>{place.name}</h2>
        <p className="created-by">
          Created by <CreatorLink item={place} />
        </p>
        <div className="banner-bottom">
          <span>
            {countLabel(place.boulders.length, 'boulder')} ·{' '}
            {countLabel(
              place.boulders.reduce((s, b) => s + (b.problems || []).length, 0),
              'problem'
            )}{' '}
            ·{' '}
            {countLabel(
              place.boulders.reduce((s, b) => s + b.images.length, 0),
              'photo'
            )}{' '}
            ·{' '}
            {countLabel(
              place.boulders.reduce((s, b) => s + (b.videos || []).length, 0),
              'video'
            )}
          </span>
          <div className="location-actions">
            {canEdit(place) && (
              <button
                disabled={busy || !canEdit(place)}
                onClick={() => {
                  setError('');
                  setModal('editLocation');
                }}
              >
                Edit location ↗
              </button>
            )}
            {canEdit(place) && (
              <button
                disabled={busy || !canEdit(place)}
                onClick={() => {
                  setError('');
                  setModal({ removeLocation: place });
                }}
              >
                Remove location
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="location-info">
        <div>
          <h3>
            <Icon name="pin" /> Coordinates
          </h3>
          {place.latitude && place.longitude ? (
            <>
              <p className="coordinates">
                {Number(place.latitude).toFixed(5)}, {Number(place.longitude).toFixed(5)}
              </p>
              <a
                target="_blank"
                rel="noreferrer"
                href={
                  'https://www.google.com/maps/search/?api=1&query=' +
                  encodeURIComponent(`${place.latitude},${place.longitude}`)
                }
              >
                Open in maps ↗
              </a>
            </>
          ) : (
            <button className="text-button" disabled={!canEdit(place)} onClick={() => setModal('editLocation')}>
              + Add coordinates
            </button>
          )}
        </div>
        <div>
          <h3>Approach notes</h3>
          <p className="preserve">
            {place.approach || 'Add parking details, the path to follow, and access information.'}
          </p>
        </div>
      </div>
      <section>
        <div className="section-heading photos-heading">
          <div>
            <h3>Parking & Approach Photos</h3>
            <p>Photos to help find the parking and approach.</p>
          </div>
          <label
            title={!user ? 'Create an account to contribute' : undefined}
            className={`secondary small upload ${busy || !user ? 'disabled' : ''}`}
          >
            + Upload photos
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy || !user}
              onChange={upload}
            />
          </label>
        </div>
        {place.photos?.length ? (
          <div className="photo-grid">
            {place.photos.map(photo => (
              <figure className="problem-photo" key={photo.id}>
                <div className="photo-thumb">
                  <img src={photo.url} alt={photo.caption || photo.name} loading="lazy" />
                </div>
                <figcaption>
                  <strong>{photo.name}</strong>
                  <p className="preserve">{photo.caption}</p>
                  {canEdit(photo) && (
                    <div className="problem-media-actions">
                      <button
                        className="secondary small"
                        disabled={busy}
                        onClick={() => {
                          setError('');
                          setModal({ locationCaption: photo });
                        }}
                      >
                        Edit caption
                      </button>
                      <button
                        className="remove-media"
                        disabled={busy}
                        onClick={() => {
                          setError('');
                          setModal({ removeLocationPhoto: photo });
                        }}
                      >
                        Remove photo
                      </button>
                    </div>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="problem-empty">No parking or approach photos yet.</p>
        )}
      </section>
      <div className="section-heading boulders-heading">
        <div>
          <h3>
            Boulders <span className="count">{place.boulders.length}</span>
          </h3>
          <p>The boulders at {place.name}.</p>
        </div>
        <button
          title={!user ? 'Create an account to contribute' : undefined}
          className="secondary small"
          aria-disabled={busy || !user}
          onClick={() => {
            if (!busy && user) setModal('boulder');
          }}
        >
          + Add boulder
        </button>
      </div>
      {!place.boulders.length ? (
        <div className="photo-empty">
          <Icon name="mountain" />
          <h3>A location full of possibilities.</h3>
          <p>Add the first boulder to start adding problems, photos and videos.</p>
        </div>
      ) : (
        <div className="boulder-list">
          {place.boulders.map((b, i) => (
            <button className="boulder-row" key={b.id} onClick={() => choose(place.id, b.id)}>
              <span className="boulder-avatar">
                {b.images[0] ? (
                  <img
                    src={(b.images.find(image => image.onBoulderPage !== false) || b.images[0]).url}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <Icon name="mountain" />
                )}
              </span>
              <div>
                <span className="eyebrow">BOULDER {String(i + 1).padStart(2, '0')}</span>
                <strong>{b.name}</strong>
                <p>{b.notes || 'Add directions to this boulder'}</p>
              </div>
              <span className="boulder-meta">
                {countLabel((b.problems || []).length, 'problem')} · {countLabel(b.images.length, 'photo')} ·{' '}
                {countLabel((b.videos || []).length, 'video')}
              </span>
              <span>↗</span>
            </button>
          ))}
        </div>
      )}
      <section className="location-links">
        <div className="section-heading photos-heading">
          <div>
            <h3>Additional links</h3>
            <p>UKC, tide charts, YouTube videos, relevant books and other useful resources.</p>
          </div>
          {canEdit(place) && (
            <button
              className="secondary small"
              disabled={busy}
              onClick={() => {
                setError('');
                setModal({ locationLinks: true });
              }}
            >
              Edit links
            </button>
          )}
        </div>
        {place.links?.length ? (
          <ul>
            {place.links
              .filter(link => validLocationLinks([link]))
              .map((link, index) => (
                <li key={index}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.label} ↗
                  </a>
                </li>
              ))}
          </ul>
        ) : (
          <p className="problem-empty">No additional links yet.</p>
        )}
      </section>
    </>
  );
}
