# couch-daemon-triggerjob

Database-driven daemon to extend CouchDB and Couchapps with asynchronous events handling and scheduling.

## Use cases

Can be used to extend Couchapps capabilities with tasks like:

* [send **e-mails**](https://www.smileupps.com/couch-triggerjob-send-email)
* send **SMS**

* interact with **third party APIs**:
    * authorize/receive **Paypal** payments
    * authorize/receive **Stripe** payments
    * get any HTML page on the internet, parse it and react accordingly

* **schedule http requests at regular intervals**:
	* to have a **daily backup** of your database
	* to **automatically generate a weekly newsletter** from your database documents, and send it via e-mail
	* to **generate a monthly report** from your documents, and send it via e-mail

* **interact with your own database**: by retrieving documents, list or views, or [executing actions](https://www.smileupps.com/couchapp-tutorial-chatty-write-api) to modify its state

* **transactions or chains**: to update multiple documents at-once, or more generally, to chain multiple tasks/requests, such as:
	* if user *Pippo* registers:
	  * create the user document *org.couchdb.user:pippo*, 
	  * create a new database named *db-pippo*,
	  * secure *db-pippo* to be accessed by *pippo* only, 
	  * replicate initial data/couchapps from an external db to *db-pippo*
	  * check *pippo*'s ranking on Stackoverflow and store it within his user document


# Installation

## The easy, fast install

All applications within the [Smileupps store](https://www.smileupps.com/store/category/hosting-apps) come with *couch-daemon-triggerjob* preinstalled. All you need is to [configure your couchapps](#couchapp-configuration).

1. Install one of the [CouchDB Hosting upps](https://www.smileupps.com/store/category/hosting-apps) to get CouchDB Hosting service
1. Wait your upp activation e-mail
1. Proceed to [Couchapp Configuration](#couchapp-configuration)

## Manual install

**Prerequisites**

* [Apache CouchDB](http://couchdb.apache.org)
* [Node.js](https://nodejs.org/)
* [iriscouch/follow](https://github.com/iriscouch/follow)

	npm install -g iriscouch/follow

**Steps**

1. Download *triggerjob.js* file to your CouchDB machine
1. Grant execute permissions
1. Within your CouchDB configuration create a new parameter:

		section: os_daemons
		parameter: triggerjob
		value: /usr/bin/node /path/to/your/triggerjob.js
	
1. Proceed to [Couchapp Configuration](#couchapp-configuration)

# Couchapp Configuration

To let daemon interact with your documents stored in database X, you will need to:

1. install [couchapp-triggerjob](https://github.com/Smileupps/couchapp-triggerjob) to database X
2. set CouchDB configuration parameter *triggerjob->job_path* to */X/_design/trigger/_rewrite*
