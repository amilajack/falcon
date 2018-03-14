// @flow
import React, { Component } from 'react';
import Login from '../components/Login';

export default class LoginPage extends Component {
  render() {
    return (
      <Login
        history={this.props.history}
        connectionManager={this.props.connectionManager}
      />
    );
  }
}
