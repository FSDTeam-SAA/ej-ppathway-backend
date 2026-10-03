import assert from 'node:assert/strict';
import test from 'node:test';
import User from '../models/user.model.js';
import AdvisorProfile from '../models/advisorProfile.model.js';
import AdvisorApplication from '../models/advisorApplication.model.js';
import PlatformSetting from '../models/platformSetting.model.js';
import { updateAdvisor } from '../controllers/admin.advisors.controller.js';
import { updateMyProfile } from '../controllers/advisor.controller.js';

function invoke(handler, body) {
  return new Promise((resolve, reject) => {
    handler(
      { params: { id: 'advisor-1' }, user: { _id: 'advisor-1', role: 'advisor' }, body },
      { status() { return this; }, json: resolve },
      reject
    );
  });
}

for (const [name, handler] of [['Admin', updateAdvisor], ['Advisor', updateMyProfile]]) {
  test(`${name} updates the shared bio and removes media independently`, async (t) => {
    const user = { _id: 'advisor-1', role: 'advisor', profilePhoto: 'photo.jpg' };
    const profile = { bio: 'Original', audioMessageUrl: 'audio.mp3', introVideoUrl: 'video.mp4' };
    const application = { ...profile };
    t.mock.method(User, 'findOne', async () => user);
    t.mock.method(User, 'findById', async () => user);
    t.mock.method(User, 'findByIdAndUpdate', async (_, patch) => Object.assign(user, patch));
    t.mock.method(AdvisorProfile, 'findOne', () => ({
      lean: async () => ({ ...profile }),
      then: (resolve) => Promise.resolve({ ...profile }).then(resolve)
    }));
    t.mock.method(AdvisorProfile, 'findOneAndUpdate', async (_, patch) => {
      Object.assign(profile, patch.$set || patch);
      return { ...profile };
    });
    t.mock.method(AdvisorApplication, 'updateOne', async (_, patch) => Object.assign(application, patch.$set));
    t.mock.method(PlatformSetting, 'findOne', async () => ({
      tierThresholds: {}, creditPackCatalogVersion: 2
    }));

    await invoke(handler, { bio: 'Updated brief bio' });
    assert.equal(profile.bio, 'Updated brief bio');
    assert.equal(application.bio, profile.bio);

    await invoke(handler, { audioMessageUrl: '' });
    assert.equal(profile.audioMessageUrl, '');
    assert.equal(application.audioMessageUrl, '');
    assert.equal(profile.introVideoUrl, 'video.mp4');
    assert.equal(user.profilePhoto, 'photo.jpg');

    await invoke(handler, { introVideoUrl: '' });
    assert.equal(profile.introVideoUrl, '');
    assert.equal(application.introVideoUrl, '');
    assert.equal(user.profilePhoto, 'photo.jpg');

    await invoke(handler, { profilePhoto: '' });
    assert.equal(user.profilePhoto, '');
    assert.equal(profile.bio, 'Updated brief bio');
  });
}
