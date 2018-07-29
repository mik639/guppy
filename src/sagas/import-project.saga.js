import { call, put, cancel, select, takeEvery } from 'redux-saga/effects';
import {
  importExistingProjectStart,
  importExistingProjectFinish,
  importExistingProjectError,
  SHOW_IMPORT_EXISTING_PROJECT_PROMPT,
  IMPORT_EXISTING_PROJECT_START,
} from '../actions';
import {
  loadPackageJson,
  writePackageJson,
} from '../services/read-from-disk.service';
import { getColorForProject } from '../services/create-project.service';
import { getInternalProjectById } from '../reducers/projects.reducer';

const { dialog } = window.require('electron').remote;

/**
 * Handle path to project
 * @param {Array<string>} paths
 */
export function* handlePathInput(paths) {
  // The user might cancel out without selecting a directory.
  // In that case, do nothing.
  if (!paths) yield cancel();

  // Only a single path should be selected
  const [path] = paths;
  yield put(importExistingProjectStart(path));
}

/**
 * Show import dialog
 */
export function* showImportDialog() {
  const paths = yield call([dialog, 'showOpenDialog'], {
    message: 'Select the directory of an existing React app',
    properties: ['openDirectory'],
  });
  yield call(handlePathInput, paths);
}

/**
 * Show alert with error message that depends from error type
 * @param {Error} err
 */
export function* handleImportError(err) {
  switch (err.message) {
    case 'project-name-already-exists': {
      yield call(
        [dialog, 'showErrorBox'],
        'Project name already exists',
        "Egad! A project with that name already exists. Are you sure it hasn't already been imported?"
      );
      break;
    }

    case 'unsupported-project-type': {
      yield call(
        [dialog, 'showErrorBox'],
        'Unsupported project type',
        "Looks like the project you're trying to import isn't supported. Unfortunately, Guppy only supports projects created with create-react-app or Gatsby"
      );
      break;
    }

    default: {
      yield call([console, 'error'], err);
      yield call(
        [dialog, 'showErrorBox'],
        'Unknown error',
        'An unknown error has occurred. Sorry about that! Details have been printed to the console.'
      );
      break;
    }
  }
}

export function* importProject({ path }) {
  try {
    // Let's load the basic project info for the path specified, if possible.
    const json = yield call(loadPackageJson, path);
    const projectId = json.name;

    // Check to see if we already have a project with this ID.
    // In the future, maybe I can attach a suffix like `-copy`, but for
    // now I'll just reject it outright.
    const isAlredyExist = yield select(getInternalProjectById, projectId);
    if (isAlredyExist) throw new Error('project-name-already-exists');

    // Guppy only supports create-react-app and Gatsby projects atm.
    // Hopefully one day, arbitrary projects will have first-class
    // support... but for now, I'm prioritizing an A+ experience for
    // supported project types.
    const type = yield call(inferProjectType, json);
    if (!type) throw new Error('unsupported-project-type');

    // Get a random color for the project, to be used in place of an
    // icon.
    // TODO: Try importing the existing project's favicon as icon instead?
    const color = yield call(getColorForProject, json.name);
    const packageJsonWithGuppy = {
      ...json,
      guppy: {
        id: json.name,
        name: json.name,
        type,
        color,
        icon: null,
        createdAt: Date.now(),
      },
    };

    const writedPackageJson = yield call(
      writePackageJson,
      path,
      packageJsonWithGuppy
    );

    yield put(importExistingProjectFinish(path, writedPackageJson));
  } catch (err) {
    yield call(handleImportError, err);
    yield put(importExistingProjectError());
  }
}

export const inferProjectType = json => {
  // Some projects only have devDependencies.
  // If this is the case, we can bail early, since no supported project types
  // avoid having `dependencies`.
  if (!json.dependencies) {
    return null;
  }

  const dependencyNames = Object.keys(json.dependencies);

  if (dependencyNames.includes('gatsby')) {
    return 'gatsby';
  } else if (dependencyNames.includes('react-scripts')) {
    return 'create-react-app';
  }

  // An ejected create-react-app won't have `react-scripts`.
  // So it actually becomes kinda hard to figure out what kind of project it is!
  // One strong clue is that it will have `eslint-config-react-app` as a
  // dependency... this isn't foolproof since a user could easily uninstall
  // that dependency, but it'll work for now.
  // In the future, could also check the `config` dir for the standard React
  // scripts
  if (dependencyNames.includes('eslint-config-react-app')) {
    return 'create-react-app';
  }

  return null;
};

export default function* rootSaga() {
  yield takeEvery(SHOW_IMPORT_EXISTING_PROJECT_PROMPT, showImportDialog);
  yield takeEvery(IMPORT_EXISTING_PROJECT_START, importProject);
}
