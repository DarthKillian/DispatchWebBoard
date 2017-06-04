/* globals GetCookie, CanSetCookies, SetCookie, DelCookie */

/**
 * Handles stores user data and authentication information.
 */
fr.user = !fr.config ? null : {
  ApiData: null,
  Settings: null,
  AuthHeader: null,

  /**
   * Checks if the user is currently authenticated with the API
   * @return {Boolean} Value representing the authentication status of the user.
   */
  isAuthenticated: function() { return this.ApiData !== null && this.AuthHeader !== null; },

  /**
   * Checks if the user has permission to use the dispatch board
   * @return {Boolean} Value representing the permission status of the user.
   */
  hasPermission: function() { return this.isAuthenticated() && (this.ApiData.group === "admin" || this.ApiData.drilled); },

  /**
   * Initialization entry point. Run on page load.
   */
  init: function() {
    let authHeader = GetCookie(fr.config.CookieBase + "token");
    let tokenMatch = document.location.hash.match(/access_token=([\w-]+)/);
    let token = !!tokenMatch && tokenMatch[1];

    window.console.debug("fr.user.init - User module loaded, Starting authentication process.");

    if (token) {
      this.AuthHeader = token;
      if (CanSetCookies()) {
        SetCookie(fr.config.CookieBase + "token", this.AuthHeader, 365 * 24 * 60 * 60 * 1000); // 1 year. days * hours * minutes * seconds * milisec
      }
      if (window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
    } else if (authHeader) {
      this.AuthHeader = authHeader.replace("Bearer ", "");
      if (CanSetCookies()) {
        SetCookie(fr.config.CookieBase + "token", this.AuthHeader, 365 * 24 * 60 * 60 * 1000); // 1 year. days * hours * minutes * seconds * milisec
      }
    } else {
      this.DisplayLogin();
      return;
    }

    window.console.debug("fr.user.init - Auth token gathered, ensuring authentication and getting user data.");

    //Check if user has authentication in the current session, otherwise check the 
    if (sessionStorage.getItem("user.ApiData")) {
      this.ApiData = JSON.parse(sessionStorage.getItem("user.ApiData"));
      this.handleLoginInit();
    } else {
      this.getApiData(this.AuthHeader).then((data) => {
        sessionStorage.setItem("user.ApiData", JSON.stringify(data));
        this.ApiData = data;
        this.handleLoginInit();
      }).catch((error) => {
        this.handleApiDataFailure(error);
      });
    }

  },

  /**
   * Removes the user's authentication token and reloads the webpage.
   */
  logoutUser: function() {
    DelCookie(fr.config.CookieBase + "token");
    window.location.reload();
  },

  /**
   * Activates the web board if the user has permission
   */
  handleLoginInit: function() {
    if (!this.hasPermission()) {
      $("body")
        .removeClass("loading")
        .addClass("shutter-force user-nopermission");
      return;
    }

    $('body').on('click', 'button.logout', () => {
      this.logoutUser();
    });

    window.console.log("%cWelcome CMDR " + this.ApiData.rats[0].CMDRname.toUpperCase() + ". All is well here. Fly safe!", 'color: lightgreen; font-weight: bold; font-size: 1.25em;');

    fr.ws.initConnection();
    fr.client.init();
  },

  /**
   * Handles API information retrieval errors. TODO: add better user notification that retrieval went wrong.
   * @param {Object} error Error object passed from an Api XHR request error.
   */
  handleApiDataFailure: function(error) {

    if (debug) {
      window.console.log("Api retrieval failure - Displaying login - Error Info: ", error);
    }

    this.DisplayLogin();
  },

  /**
   * Forces the page shutter, activates and displays the login button.
   */
  DisplayLogin: function() {

    window.history.replaceState('', document.title, window.location.pathname);

    $("button.login").on('click', () => {
      window.location.href = fr.config.ApiURI + "oauth2/authorize" +
        "?response_type=token" +
        "&client_id=" + fr.config.ClientID +
        "&redirect_uri=" + window.location;
    });

    $('body')
      .removeClass("loading")
      .addClass("shutter-force user-unauthenticated");

  },

  /**
   * Gets api profile for the user matching the given auth token.
   * @param  {string}  token OAuth2 bearer token
   * @return {Promise}       Resolves on response with the returned data.
   *                         Rejects on error with object of the error data.
   */
  getApiData: function(token) {
    return new Promise((resolve, reject) => {
      $.ajax({
        url: fr.config.ApiURI + "profile",
        beforeSend: (request) => {
          request.setRequestHeader('Authorization', 'Bearer ' + token);
          request.setRequestHeader('Accept', "application/json");
        },
        success: (response) => {
          if (response && response.data) {
            if (debug) {
              window.console.log("fr.user.getApiData - Retrieved authenticated user information: ", response);
            }
            resolve(response.data);
          }
        },
        error: (request, status, error) => {
          reject({
            "request": request,
            "status": status,
            "error": error
          });
        }
      });
    });
  }
};