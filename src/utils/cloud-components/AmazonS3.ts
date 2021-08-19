/**
 * Amazon S3 Component for all plugin's S3 actions
 * @date 29 July 2021
 * @plugin Tabby Cloud Sync Settings
 * @author Tran IT <tranit1209@gmail.com>
 * @licence MIT
 */
import {Endpoint, S3, SharedIniFileCredentials} from 'aws-sdk'
import {ConfigService, PlatformService} from "terminus-core";
import {ToastrService} from "ngx-toastr";
import CloudSyncSettingsData from "../../data/setting-items";
import * as yaml from "js-yaml";
import CloudSyncLang from "../../data/lang";
import SettingsHelper from "../settings-helper";
import {AmazonParams} from "../../interface";
import Logger from '../../utils/Logger'

let isSyncingInProgress = false
class AmazonS3Class {
    private provider = CloudSyncSettingsData.values.S3
    private appId
    private appSecret
    private bucket
    private region
    private path

    private PERMISSIONS = {
        PUBLIC: 'public-read',
    }
    private TEST_FILE = {
        type: 'text/plain',
        name: 'test.txt',
        content: 'This is test file',
    }

    setProvider(provider: string) {
        this.provider = provider
    }

    setConfig (appId, appSecret, bucket, region, path) {
        this.appId = appId
        this.appSecret = appSecret
        this.bucket = bucket
        this.region = region
        this.path = path === '/' ? '' : path
    }

    /**
     * Test the connection to Amazon S3 configurators
     *
     * @return Object
     * */
    testConnection = async (platform: PlatformService, s3_params) => {
        const logger = new Logger(platform)
        let amazonS3 = this.createClient(s3_params)

        const params = {
            Bucket: this.bucket,
            Key: this.path + this.TEST_FILE.name,
            Body: this.TEST_FILE.content,
            ACL: this.PERMISSIONS.PUBLIC,
            ContentType: this.TEST_FILE.type,
        }
        let response: any

        try {
            response = await amazonS3.upload(params, (err, data) => {
                if (err) {
                    console.log(err)
                    logger.log(CloudSyncLang.trans('log.error_test_connection') + ' #1 | Exception: ' + err.message, 'error')
                    return { code: 0, message: err.message }
                } else {
                    return { code: 1, data: data }
                }
            }).promise()
        } catch (e) {
            logger.log(CloudSyncLang.trans('log.error_test_connection') + ' #2 | Exception: ' + e.toString(), 'error')
            response = { code: 0, message: e.toString() }
        }

        return response
    }

    async sync (config: ConfigService, platform: PlatformService, toast: ToastrService, params: AmazonParams, firstInit = false) {
        const logger = new Logger(platform)
        let result = false
        const client = this.createClient(params)
        let remoteFile
        if (this.path === '') {
            remoteFile = CloudSyncSettingsData.cloudSettingsFilename.substr(1, CloudSyncSettingsData.cloudSettingsFilename.length)
        } else {
            remoteFile = this.path + CloudSyncSettingsData.cloudSettingsFilename
        }

        const uploadObjectParams = {
            Bucket: this.bucket,
            Key: remoteFile,
            Body: SettingsHelper.readTabbyConfigFile(platform, true, true),
            ACL: this.PERMISSIONS.PUBLIC,
            ContentType: 'application/json',
        }

        try {
            const objectParams = { Bucket: params.bucket, Key: remoteFile }
            await client.getObject(objectParams).promise().then(async (data) => {
                const content = data.Body.toString()
                try {
                    yaml.load(content)
                    if (firstInit) {
                        if ((await platform.showMessageBox({
                            type: 'warning',
                            message: CloudSyncLang.trans('sync.sync_confirmation'),
                            buttons: [CloudSyncLang.trans('buttons.sync_from_cloud'), CloudSyncLang.trans('buttons.sync_from_local')],
                            defaultId: 0,
                        })).response === 1) {
                            await client.upload(uploadObjectParams)
                        } else {
                            config.writeRaw(SettingsHelper.doDescryption(content))
                        }
                    } else {
                        config.writeRaw(SettingsHelper.doDescryption(content))
                    }
                } catch (e) {
                    toast.error(CloudSyncLang.trans('sync.error_invalid_setting'))
                    const copyObjectParams = {
                        CopySource: remoteFile,
                        Bucket: this.bucket,
                        Key: remoteFile + '_bk' + new Date().getTime()
                    }
                    await client.copyObject(copyObjectParams)
                    await client.upload(uploadObjectParams).promise()
                    logger.log(CloudSyncLang.trans('log.read_cloud_settings') + ' | Exception: ' + e.toString(), 'error')
                }
                result = true
            })
        } catch (e) {
            logger.log(CloudSyncLang.trans('log.read_cloud_settings') + ' | Exception: ' + e.toString())
            try {
                await client.upload(uploadObjectParams).promise()
                result = true
            } catch (e) {
                logger.log(CloudSyncLang.trans('log.error_upload_settings') + ' | Exception: ' + e.toString(), 'error')
            }
        }

        return result
    }

    async syncLocalSettingsToCloud (platform: PlatformService, toast: ToastrService) {
        const logger = new Logger(platform)
        if (!isSyncingInProgress) {
            isSyncingInProgress = true

            const savedConfigs = SettingsHelper.readConfigFile(platform)
            this.setProvider(savedConfigs.adapter)
            const params = savedConfigs.configs
            const client = this.createClient(params)
            let remoteFile
            if (this.path === '') {
                remoteFile = CloudSyncSettingsData.cloudSettingsFilename.substr(1, CloudSyncSettingsData.cloudSettingsFilename.length)
            } else {
                remoteFile = this.path + CloudSyncSettingsData.cloudSettingsFilename
            }

            let response: any = {}
            const uploadObjectParams = {
                Bucket: this.bucket,
                Key: remoteFile,
                Body: SettingsHelper.readTabbyConfigFile(platform, true, true),
                ACL: this.PERMISSIONS.PUBLIC,
                ContentType: 'application/json',
            }
            try {
                response = await client.upload(uploadObjectParams).promise()
            } catch (e) {
                logger.log(CloudSyncLang.trans('log.error_upload_settings') + ' | Exception: ' + e.toString(), 'error')
                if (isSyncingInProgress) {
                    toast.error(CloudSyncLang.trans('sync.sync_error'))
                }
            }

            if (response) {
                toast.info(CloudSyncLang.trans('sync.sync_success'))
            }
            isSyncingInProgress = false
        }
    }

    private createClient (params: AmazonParams) {
        this.setConfig(params.appId, params.appSecret, params.bucket, params.region, params.location)
        switch (this.provider) {
            case CloudSyncSettingsData.values.WASABI: {
                console.log("Fetch Wasabi instance")
                return new S3(
                    {
                        accessKeyId: this.appId,
                        secretAccessKey: this.appSecret,
                        region: this.region,
                        endpoint: new Endpoint(CloudSyncSettingsData.amazonEndpoints.WASABI),
                    }
                )
            }
            default: {
                console.log("Fetch Amazon instance")
                return new S3(
                    {
                        accessKeyId: this.appId,
                        secretAccessKey: this.appSecret,
                        region: this.region,
                    }
                )
            }
        }
    }
}

export default new AmazonS3Class()
